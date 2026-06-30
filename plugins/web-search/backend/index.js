/**
 * Web Search Plugin — backend entry.
 *
 * Тулз «web_search»: вебпошук через DuckDuckGo (ddgr, без ключа, default) або
 * Tavily (опц., з API-ключем). Backend обирається в settings (web-search.json).
 *
 * Контракт інструменту — AgentTool з @coudycode/agent-core:
 *   { name, description, parameters: TSchema, label, execute: (id, params) => AgentToolResult }
 *
 * Config: ~/.coudycode/web-search.json (0o600), { backend: "ddgr"|"tavily", tavilyKey?: string }.
 * Routes: GET/POST /api/web-search/config (GET НЕ віддає сам ключ — лише hasKey).
 */

import { readFile, writeFile, mkdir, chmod } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { spawn } from "node:child_process";

// @ts-expect-error — typebox у root node_modules; плагін працює в контексті сервера.
import { Type } from "typebox";

const WRITE_OPTIONS = { encoding: "utf-8", mode: 0o600 };

function getCoudyDir() {
	const fromEnv = process.env["COUDYCODE_DIR"];
	if (fromEnv && fromEnv.trim().length > 0) return fromEnv;
	return join(homedir(), ".coudycode");
}

const CONFIG_PATH = join(getCoudyDir(), "web-search.json");

const DEFAULT_CONFIG = { backend: "ddgr" };

/** Завантажити конфіг (merge з defaults). */
async function loadConfig() {
	try {
		if (!existsSync(CONFIG_PATH)) return { ...DEFAULT_CONFIG };
		const raw = (await readFile(CONFIG_PATH, "utf-8")).trim();
		if (!raw) return { ...DEFAULT_CONFIG };
		const parsed = JSON.parse(raw);
		if (!parsed || typeof parsed !== "object") return { ...DEFAULT_CONFIG };
		return {
			backend: parsed.backend === "tavily" ? "tavily" : "ddgr",
			tavilyKey: typeof parsed.tavilyKey === "string" && parsed.tavilyKey ? parsed.tavilyKey : undefined,
		};
	} catch {
		return { ...DEFAULT_CONFIG };
	}
}

/** Зберегти конфіг (0o600). */
async function saveConfig(cfg) {
	await mkdir(dirname(CONFIG_PATH), { recursive: true });
	await writeFile(CONFIG_PATH, JSON.stringify(cfg, null, 2), WRITE_OPTIONS);
	try {
		await chmod(CONFIG_PATH, 0o600);
	} catch {
		/* chmod може не спрацювати на деяких ФС — ігноруємо */
	}
}

/** Публічне подання конфігу (без самого ключа). */
function publicConfig(cfg) {
	return { backend: cfg.backend, hasKey: !!cfg.tavilyKey };
}

/** ddgr: DuckDuckGo-пошук → [{title,url,snippet}]. */
function searchDdgr(query, maxResults) {
	return new Promise((resolve, reject) => {
		const args = ["--json", "--np", "-n", String(maxResults), query];
		const child = spawn("ddgr", args, { stdio: ["ignore", "pipe", "pipe"] });
		let stdout = "";
		let stderr = "";
		const timer = setTimeout(() => {
			child.kill("SIGKILL");
			reject(new Error("ddgr перевищив таймаут (10с)"));
		}, 10000);

		child.stdout.on("data", (d) => {
			stdout += d.toString();
		});
		child.stderr.on("data", (d) => {
			stderr += d.toString();
		});
		child.on("error", (err) => {
			clearTimeout(timer);
			// ENOENT — ddgr не встановлений.
			if (err.code === "ENOENT") {
				reject(
					new Error(
						"ddgr не встановлений. Встановіть `brew install ddgr` або налаштуйте Tavily-ключ у Settings → Web Search.",
					),
				);
				return;
			}
			reject(err);
		});
		child.on("close", (code) => {
			clearTimeout(timer);
			if (code !== 0) {
				reject(new Error(`ddgr завершився з кодом ${code}${stderr ? `: ${stderr.trim()}` : ""}`));
				return;
			}
			try {
				const parsed = JSON.parse(stdout.trim() || "[]");
				const results = Array.isArray(parsed)
					? parsed.map((x) => ({ title: x.title ?? "", url: x.url ?? "", snippet: x.abstract ?? "" }))
					: [];
				resolve(results);
			} catch (e) {
				reject(new Error("Не вдалося розпарсити JSON-вивід ddgr"));
			}
		});
	});
}

/** Tavily-пошук через REST API → [{title,url,snippet}]. */
async function searchTavily(query, maxResults, apiKey) {
	const resp = await fetch("https://api.tavily.com/search", {
		method: "POST",
		headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
		body: JSON.stringify({ query, max_results: maxResults }),
	});
	if (!resp.ok) {
		const text = await resp.text().catch(() => "");
		throw new Error(`Tavily API ${resp.status}: ${text.slice(0, 200)}`);
	}
	const data = await resp.json();
	const results = Array.isArray(data?.results)
		? data.results.map((x) => ({ title: x.title ?? "", url: x.url ?? "", snippet: x.content ?? "" }))
		: [];
	return results;
}

/** Людяне форматування результатів для LLM. */
function formatResults(results) {
	if (results.length === 0) return "Нічого не знайдено.";
	return results
		.map((r, i) => {
			const title = r.title || "(без заголовка)";
			const url = r.url || "";
			const snippet = r.snippet || "";
			return `${i + 1}. **${title}**\n   ${url}\n   ${snippet}`;
		})
		.join("\n\n");
}

const webSearchSchema = Type.Object({
	query: Type.String({ description: "Пошуковий запит" }),
	max_results: Type.Optional(
		Type.Integer({
			description: "Макс. к-ть результатів (default 5)",
			minimum: 1,
			maximum: 25,
		}),
	),
});

/**
 * @param {string} toolCallId
 * @param {{ query: string; max_results?: number }} params
 */
async function executeWebSearch(toolCallId, params) {
	const query = typeof params?.query === "string" ? params.query.trim() : "";
	if (!query) {
		return {
			content: [{ type: "text", text: "Порожній запит." }],
			details: { backend: "none", count: 0 },
		};
	}
	const maxResults = Math.min(Math.max(Number(params?.max_results) || 5, 1), 25);
	const cfg = await loadConfig();

	let results = [];
	let backend = cfg.backend;
	try {
		if (cfg.backend === "tavily" && cfg.tavilyKey) {
			results = await searchTavily(query, maxResults, cfg.tavilyKey);
		} else {
			backend = "ddgr";
			results = await searchDdgr(query, maxResults);
		}
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		return {
			content: [{ type: "text", text: `Помилка пошуку: ${msg}` }],
			details: { backend, count: 0, error: msg },
		};
	}

	const text = formatResults(results);
	return {
		content: [{ type: "text", text }],
		details: { backend, count: results.length, results },
	};
}

const webSearchTool = {
	name: "web_search",
	description:
		"Вебпошук в інтернеті за запитом. Повертає заголовок, URL та уривок найрелевантніших результатів (DuckDuckGo або Tavily). Використовуй, коли потрібна актуальна інформація, якої може не бути у твоїх знаннях.",
	parameters: webSearchSchema,
	label: "Web Search",
	execute: executeWebSearch,
};

export function activate(ctx) {
	ctx.utils.log("активовано (web-search)");

	// --- Filter: додати тулз «web_search» ---
	ctx.hooks.addFilter("tools:register", (tools) => {
		return [...tools, webSearchTool];
	});

	// --- Filter: підказати агенту про доступність вебпошуку ---
	ctx.hooks.addFilter("prompt:system", (prompt) => {
		return (
			prompt +
			"\n\n[web-search]: У тебе є інструмент «web_search» — шукай актуальну інформацію в інтернеті, коли користувач питає про свіжі новини, події або дані, яких може не бути у твоїх знаннях."
		);
	});

	// --- HTTP-роути конфігу ---
	ctx.hooks.addFilter("server:routes", (routes) => {
		return [
			...routes,
			{
				method: "GET",
				path: "/api/web-search/config",
				handler: async ({ sendJson }) => {
					const cfg = await loadConfig();
					sendJson(200, publicConfig(cfg));
				},
			},
			{
				method: "POST",
				path: "/api/web-search/config",
				handler: async ({ sendJson, sendError, readJsonBody }) => {
					const body = await readJsonBody();
					if (!body || typeof body !== "object") {
						sendError(400, "Потрібне JSON-тіло");
						return;
					}
					const current = await loadConfig();
					const next = {
						backend: body.backend === "tavily" ? "tavily" : "ddgr",
						tavilyKey:
							typeof body.tavilyKey === "string" && body.tavilyKey
								? body.tavilyKey
								: current.tavilyKey,
					};
					await saveConfig(next);
					sendJson(200, publicConfig(next));
				},
			},
		];
	});
}

export function deactivate(ctx) {
	ctx.utils.log("деактивовано (web-search)");
}
