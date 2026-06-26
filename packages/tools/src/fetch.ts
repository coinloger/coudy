/**
 * Fetch tool — HTTP + jq + regex.
 *
 * Робить HTTP-запит і повертає компактний результат:
 *   - За замовчуванням: status + перші N байт body
 *   - З `jq`: результат jq-фільтрації (повний синтаксис jq 1.8 через jq-wasm)
 *   - З `regex`: перший match (capture group 1 або весь match)
 *
 * Output жорстко обмежений maxBytes (за замовчуванням 4KB) — значно менше
 * ніж 50KB у bash. Це спеціально для sub-agent контексту: сирий JSON
 * не повинен забивати context window.
 *
 * Помилки завжди повертаються як текст, не тихо (на відміну від curl|python3).
 */

import type { AgentTool } from "@coudycode/agent-core";
import { type Static, Type } from "typebox";
import type { ToolDefinition } from "./types.ts";
import { wrapToolDefinition } from "./tool-definition-wrapper.ts";
import { truncateTail } from "./truncate.ts";

const DEFAULT_FETCH_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_BYTES = 4 * 1024; // 4KB — жорсткий ліміт на вивід
const MAX_BODY_BYTES_READ = 2 * 1024 * 1024; // Читаємо не більше 2MB з мережі

const fetchSchema = Type.Object({
	url: Type.String({
		description: "Absolute HTTP(S) URL including query string",
	}),
	method: Type.Optional(
		Type.Union([Type.Literal("GET"), Type.Literal("POST"), Type.Literal("PUT"), Type.Literal("DELETE")], {
			description: "HTTP method (default: GET)",
		}),
	),
	headers: Type.Optional(
		Type.Record(Type.String(), Type.String(), {
			description: "Request headers (e.g. {Authorization: 'Bearer ...'})",
		}),
	),
	body: Type.Optional(Type.String({ description: "Request body for POST/PUT (sent as-is)" })),
	jq: Type.Optional(
		Type.String({
			description:
				"jq 1.8 query applied to JSON response body (e.g. '.chains[] | {currency, fee: .withdraw_fee}'). Requires Content-Type: application/json.",
		}),
	),
	regex: Type.Optional(
		Type.String({
			description:
				"JavaScript regex applied to response body. If it has a capture group, group 1 is returned; otherwise the full match is returned. Use this for non-JSON or simple extractions.",
		}),
	),
	maxBytes: Type.Optional(
		Type.Number({
			description: `Max bytes of output (default ${DEFAULT_MAX_BYTES}, applied after jq/regex)`,
		}),
	),
});

export type FetchToolInput = Static<typeof fetchSchema>;

export interface FetchToolDetails {
	status: number;
	contentType: string | null;
	outputBytes: number;
	truncated: boolean;
	application: "jq" | "regex" | "raw" | "error";
}

/**
 * Lazy-import jq-wasm щоб не тягнути WASM-модуль у бандл, якщо fetch
 * не викликається. jq-wasm ініціалізує ~1MB WASM при першому використанні.
 */
async function applyJq(input: unknown, query: string): Promise<string> {
	const mod = await import("jq-wasm");
	const result = await mod.json(input as any, query, ["-c"]);
	if (result === null) return "(jq: query produced no output)";
	if (Array.isArray(result)) {
		return result.map((r) => (typeof r === "string" ? r : JSON.stringify(r))).join("\n");
	}
	return typeof result === "string" ? result : JSON.stringify(result);
}

function applyRegex(body: string, pattern: string): string {
	const re = new RegExp(pattern);
	const match = re.exec(body);
	if (!match) return `(regex: no match for /${pattern}/)`;
	if (match.length > 1 && match[1] !== undefined) return match[1];
	return match[0];
}

function truncateOutput(text: string, maxBytes: number): { content: string; truncated: boolean; outputBytes: number } {
	const totalBytes = Buffer.byteLength(text, "utf-8");
	if (totalBytes <= maxBytes) {
		return { content: text, truncated: false, outputBytes: totalBytes };
	}
	const result = truncateTail(text, { maxBytes, maxLines: Number.POSITIVE_INFINITY });
	return { content: result.content, truncated: true, outputBytes: Buffer.byteLength(result.content, "utf-8") };
}

export function createFetchToolDefinition(): ToolDefinition<typeof fetchSchema, FetchToolDetails> {
	return {
		name: "fetch",
		label: "Fetch",
		description: [
			"Make an HTTP request and return a small, structured response.",
			`Output is hard-capped to ${DEFAULT_MAX_BYTES / 1024}KB (configurable via maxBytes).`,
			"For JSON responses, use the 'jq' parameter (full jq 1.8 syntax) to extract only the fields you need.",
			"For non-JSON or simple extractions, use 'regex' (JavaScript regex, capture group 1 if present).",
			"Prefer this over bash curl | python3 — it returns concise, structured output and never silently fails.",
		].join(" "),
		promptSnippet: "HTTP request with jq/regex post-processing — returns small structured output",
		promptGuidelines: [
			"Prefer 'fetch' over `bash curl` for HTTP requests to APIs. fetch returns a small structured response (hard-capped to 4KB).",
			"Use the 'jq' parameter for JSON APIs — it runs full jq 1.8 syntax. Example: jq='.chains[] | {currency, fee: .withdraw_fee}'.",
			"Use the 'regex' parameter for non-JSON or simple text extraction (capture group 1 if present, else full match).",
			"fetch never silently fails — network errors, non-200 status, and parse errors are returned as text in the result.",
		],
		parameters: fetchSchema,
		async execute(_toolCallId, params, signal, _onUpdate, _ctx) {
			const { url, method = "GET", headers, body, jq, regex, maxBytes = DEFAULT_MAX_BYTES } = params;

			// Базова валідація URL
			let parsedUrl: URL;
			try {
				parsedUrl = new URL(url);
			} catch {
				return {
					content: [{ type: "text", text: `fetch: invalid URL — ${url}` }],
					details: {
						status: 0,
						contentType: null,
						outputBytes: 0,
						truncated: false,
						application: "error",
					} satisfies FetchToolDetails,
				};
			}
			if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
				return {
					content: [{ type: "text", text: `fetch: only http/https supported (got ${parsedUrl.protocol})` }],
					details: {
						status: 0,
						contentType: null,
						outputBytes: 0,
						truncated: false,
						application: "error",
					} satisfies FetchToolDetails,
				};
			}

			if (jq && regex) {
				return {
					content: [{ type: "text", text: "fetch: 'jq' and 'regex' are mutually exclusive — pick one" }],
					details: {
						status: 0,
						contentType: null,
						outputBytes: 0,
						truncated: false,
						application: "error",
					} satisfies FetchToolDetails,
				};
			}

			// HTTP-запит з таймаутом + abort
			const controller = new AbortController();
			const timeout = setTimeout(() => controller.abort(), DEFAULT_FETCH_TIMEOUT_MS);
			const onAbort = () => controller.abort();
			if (signal) {
				if (signal.aborted) controller.abort();
				else signal.addEventListener("abort", onAbort, { once: true });
			}

			let response: Response;
			try {
				response = await fetch(parsedUrl.href, {
					method,
					headers,
					body: body ?? undefined,
					signal: controller.signal,
					redirect: "follow",
				});
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				return {
					content: [{ type: "text", text: `fetch: network error — ${msg}` }],
					details: {
						status: 0,
						contentType: null,
						outputBytes: 0,
						truncated: false,
						application: "error",
					} satisfies FetchToolDetails,
				};
			} finally {
				clearTimeout(timeout);
				if (signal) signal.removeEventListener("abort", onAbort);
			}

			const contentType = response.headers.get("content-type");

			// Зчитуємо body з обмеженням MAX_BODY_BYTES_READ — захист від гігантських
			// відповідей, які розірвуть пам'ять процесу.
			let responseText: string;
			try {
				const buf = await response.arrayBuffer();
				const bytes = buf.byteLength > MAX_BODY_BYTES_READ ? buf.slice(0, MAX_BODY_BYTES_READ) : buf;
				responseText = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				return {
					content: [{ type: "text", text: `fetch: body read error — ${msg}` }],
					details: {
						status: response.status,
						contentType,
						outputBytes: 0,
						truncated: false,
						application: "error",
					} satisfies FetchToolDetails,
				};
			}

			const bodyTruncatedByNetwork = response.headers.get("content-length")
				? Number.parseInt(response.headers.get("content-length") ?? "0", 10) > MAX_BODY_BYTES_READ
				: false;

			// Парсинг JSON якщо потрібно jq або content-type підказує
			let application: FetchToolDetails["application"] = jq ? "jq" : regex ? "regex" : "raw";
			let processedText: string;

			try {
				if (jq) {
					const jsonPayload = JSON.parse(responseText);
					processedText = await applyJq(jsonPayload, jq);
				} else if (regex) {
					processedText = applyRegex(responseText, regex);
				} else {
					processedText = responseText;
					application = "raw";
				}
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				return {
					content: [
						{
							type: "text",
							text: `fetch: ${application} failed — ${msg}\n\nstatus: ${response.status}\nfirst 400 chars: ${responseText.slice(0, 400)}`,
						},
					],
					details: {
						status: response.status,
						contentType,
						outputBytes: 0,
						truncated: false,
						application: "error",
					} satisfies FetchToolDetails,
				};
			}

			// Додаємо рядок status як контекст (корисно для reasoning)
			const statusLine = `status: ${response.status}${contentType ? ` (${contentType.split(";")[0]})` : ""}${bodyTruncatedByNetwork ? " [body truncated at 2MB]" : ""}`;
			const fullText = `${statusLine}\n${processedText}`;

			const { content, truncated, outputBytes } = truncateOutput(fullText, maxBytes);

			if (truncated) {
				return {
					content: [
						{
							type: "text",
							text: `${content}\n\n[output truncated to ${maxBytes} bytes; ${outputBytes} shown]`,
						},
					],
					details: {
						status: response.status,
						contentType,
						outputBytes,
						truncated: true,
						application,
					} satisfies FetchToolDetails,
				};
			}

			return {
				content: [{ type: "text", text: content }],
				details: {
					status: response.status,
					contentType,
					outputBytes,
					truncated: false,
					application,
				} satisfies FetchToolDetails,
			};
		},
	};
}

export function createFetchTool(): AgentTool<typeof fetchSchema, FetchToolDetails> {
	return wrapToolDefinition(createFetchToolDefinition());
}

// Заглушка для додаткових options (майбутнє: proxy, auth, etc.)
export interface FetchToolOptions {}
