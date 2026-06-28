/**
 * Отримання моделей з {baseUrl}/v1/models — для кастомних провайдерів.
 * Дві гілки: OpenAI-сумісний (Bearer) та Anthropic-сумісний (x-api-key + anthropic-version).
 *
 * Порт логіки pi fetchClaudeCodeModels + OpenAI-гілка (у pi її не було).
 */
import type { ApiType, ModelDef } from "./provider-definitions.js";

interface RemoteModelEntry {
	id: string;
	display_name?: string;
	name?: string;
	// context length з різних форматів відповідей /v1/models:
	// LM Studio: data[].meta.context_length; llama.cpp: data[].meta.n_ctx; іноді top-level.
	meta?: { context_length?: number; context_window?: number; n_ctx?: number };
	context_length?: number;
	context_window?: number;
	n_ctx?: number;
}

/** Контекстне вікно моделі з /v1/models (meta + top-level). */
function pickEntryContext(entry: RemoteModelEntry): number | undefined {
	return (
		entry.meta?.context_length ??
		entry.meta?.context_window ??
		entry.meta?.n_ctx ??
		entry.context_length ??
		entry.context_window ??
		entry.n_ctx
	);
}

/** /props llama.cpp: default_generation_settings.n_ctx (іноді top-level n_ctx). */
interface LlamaCppProps {
	default_generation_settings?: { n_ctx?: number };
	n_ctx?: number;
}

/** Опитати llama.cpp /props — фолбек контексту, якщо /v1/models його не віддав. */
async function fetchPropsContext(baseUrl: string, apiKey: string): Promise<number | undefined> {
	try {
		const url = `${baseUrl.replace(/\/+$/, "")}/props`;
		const res = await fetch(url, {
			method: "GET",
			headers: { Authorization: `Bearer ${apiKey}`, accept: "application/json" },
		});
		if (!res.ok) return undefined;
		const json = (await res.json()) as LlamaCppProps;
		return json.default_generation_settings?.n_ctx ?? json.n_ctx;
	} catch {
		return undefined;
	}
}

interface RemoteModelsResponse {
	data?: RemoteModelEntry[];
	models?: RemoteModelEntry[];
}

/** Дефолти моделі (з pi parseModels). */
const DEFAULT_MODEL = {
	reasoning: false,
	input: ["text"] as ("text" | "image")[],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 128000,
	maxTokens: 16384,
};

export interface FetchModelsResult {
	models: ModelDef[];
	error?: string;
}

/**
 * Fetch GET {baseUrl}/v1/models → мапити у ModelDef (з дефолтами).
 * - openai-* → Authorization: Bearer, парсинг {data:[{id}]}
 * - anthropic-messages → x-api-key + anthropic-version: 2023-06-01, парсинг {data|models:[{id,display_name}]}
 */
export async function fetchRemoteModels(
	baseUrl: string,
	apiKey: string,
	apiType: ApiType,
): Promise<FetchModelsResult> {
	const url = `${baseUrl.replace(/\/+$/, "")}/v1/models`;

	let headers: Record<string, string>;
	if (apiType === "anthropic-messages") {
		headers = {
			"x-api-key": apiKey,
			"anthropic-version": "2023-06-01",
			accept: "application/json",
		};
	} else {
		// openai-completions / openai-responses
		headers = {
			Authorization: `Bearer ${apiKey}`,
			accept: "application/json",
		};
	}

	try {
		const res = await fetch(url, { method: "GET", headers });
		if (!res.ok) {
			return { models: [], error: `HTTP ${res.status} ${res.statusText}` };
		}
		const json = (await res.json()) as RemoteModelsResponse;
		const entries = json.data ?? json.models ?? [];
		if (!Array.isArray(entries) || entries.length === 0) {
			return { models: [], error: "Сервер повернув порожній список моделей" };
		}
		const valid = entries.filter((e) => e && typeof e.id === "string" && e.id.length > 0);
		const models: ModelDef[] = valid.map((entry) => ({
			id: entry.id,
			name: entry.display_name ?? entry.name ?? entry.id,
			reasoning: DEFAULT_MODEL.reasoning,
			input: [...DEFAULT_MODEL.input],
			cost: { ...DEFAULT_MODEL.cost },
			contextWindow: pickEntryContext(entry) ?? DEFAULT_MODEL.contextWindow,
			maxTokens: DEFAULT_MODEL.maxTokens,
		}));
		// llama.cpp /props фолбек: якщо /v1/models не віддав контекст, спробувати /props.
		if (valid.some((e) => pickEntryContext(e) === undefined)) {
			const propsCtx = await fetchPropsContext(baseUrl, apiKey);
			if (propsCtx && propsCtx > 0) {
				valid.forEach((e, i) => {
					if (pickEntryContext(e) === undefined) {
						models[i].contextWindow = propsCtx;
					}
				});
			}
		}
		if (models.length === 0) {
			return { models: [], error: "Не знайдено валідних моделей" };
		}
		return { models };
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		return { models: [], error: `Не вдалося отримати моделі: ${msg}` };
	}
}
