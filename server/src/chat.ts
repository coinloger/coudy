/**
 * SSE-хендлер /api/chat: запускає реальний агент (model + auth + tools + session)
 * і стрімить AgentEvent. Зберігає оновлену сесію після завершення.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { Agent } from "@coudycode/agent-core/node";
import { getModel } from "@coudycode/ai";
import { createAllTools } from "@coudycode/tools";
import type { AgentMessage, AgentEvent } from "@coudycode/agent-core";
import type { Model, Api } from "@coudycode/ai";
import { SessionManager } from "./sessions.js";
import { AuthStorage } from "./auth/auth-storage.js";
import { ProviderDefinitions, type ApiType } from "./auth/provider-definitions.js";

const SYSTEM_PROMPT = "Ти — coudycode, корисний AI-асистент. Відповідай українською, стисло та по суті.";

/** Конфіг моделі для запуску агента. */
interface ResolvedModel {
	model: Model<Api>;
	apiKey: string;
}

/**
 * Резолвити модель + auth-ключ для поточної обраної моделі.
 * Пресет (built-in) → authStorage.getApiKey; кастомний (models.json) → apiKey + baseUrl.
 */
export async function resolveModelForChat(
	provider: string,
	modelId: string,
	auth: AuthStorage,
	defs: ProviderDefinitions,
): Promise<ResolvedModel | { error: string }> {
	// Кастомний провайдер (models.json) — беремо baseUrl/api/apiKey з визначення.
	const customDef = defs.get(provider);
	if (customDef) {
		if (!customDef.apiKey) return { error: `Провайдер ${provider}: немає збереженого ключа` };
		const model: Model<Api> = {
			id: modelId,
			name: modelId,
			api: customDef.api as Api,
			provider,
			baseUrl: customDef.baseUrl,
			reasoning: false,
			input: ["text"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 128000,
			maxTokens: 16384,
		};
		return { model, apiKey: customDef.apiKey };
	}

	// Built-in пресет — модель з каталогу + ключ з auth (або env).
	const catalogModel = getModel(provider as never, modelId as never) as Model<Api> | undefined;
	if (!catalogModel) return { error: `Модель ${provider}/${modelId} не знайдена в каталозі` };
	const apiKey = await auth.getApiKey(provider);
	if (!apiKey) return { error: `Провайдер ${provider} не підключено — додайте ключ у Налаштуваннях` };
	return { model: catalogModel, apiKey };
}

/** Запустити чат: SSE-стрім AgentEvent + збереження сесії. */
export async function handleChat(
	req: IncomingMessage,
	res: ServerResponse,
	body: { sessionId?: unknown; message?: unknown },
	sessions: SessionManager,
	auth: AuthStorage,
	defs: ProviderDefinitions,
	currentModel: { provider: string; modelId: string } | null,
	cwd: string,
): Promise<void> {
	// SSE-заголовки.
	res.writeHead(200, {
		"Content-Type": "text/event-stream",
		"Cache-Control": "no-cache",
		Connection: "keep-alive",
		"Access-Control-Allow-Origin": "*",
	});

	const sessionId = typeof body.sessionId === "string" ? body.sessionId : null;
	const message = typeof body.message === "string" ? body.message.trim() : null;

	if (!sessionId || !message) {
		writeSSE(res, { type: "error", message: "Потрібні поля sessionId та message" });
		res.end();
		return;
	}

	// Завантажити повідомлення сесії.
	const existing = await sessions.getMessages(sessionId);
	if (existing === null) {
		writeSSE(res, { type: "error", message: "Сесію не знайдено" });
		res.end();
		return;
	}

	// Резолвити модель + ключ (модель — з сесії; null = не обрана).
	if (!currentModel) {
		writeSSE(res, { type: "error", message: "Оберіть модель у чаті (або підключіть провайдера в Налаштуваннях)" });
		res.end();
		return;
	}
	const resolved = await resolveModelForChat(currentModel.provider, currentModel.modelId, auth, defs);
	if ("error" in resolved) {
		writeSSE(res, { type: "error", message: resolved.error });
		res.end();
		return;
	}

	// НЕ додаємо user-повідомлення вручну — агент додасть його через prompt()
	// і ми збережемо нові повідомлення (user + assistant) одним блоком після agent_end.
	const startCount = existing.length;

	// Створити агента (messages = лише існуюча історія; user додається через prompt).
	const tools = createAllTools(cwd);
	const agent = new Agent({
		initialState: {
			systemPrompt: SYSTEM_PROMPT,
			model: resolved.model,
			thinkingLevel: "off",
			tools: tools as never,
			messages: existing,
		},
		getApiKey: async () => resolved.apiKey,
	});

	// Скасування при disconnect клієнта.
	const abortController = new AbortController();
	const onClose = (): void => {
		abortController.abort();
		try {
			agent.abort();
		} catch {
			/* ignore */
		}
	};
	req.on("close", onClose);

	// Стрімити події.
	let unsub: (() => void) | undefined;
	const finished = new Promise<void>((resolve) => {
		unsub = agent.subscribe((event: AgentEvent) => {
			writeSSE(res, event);
			if (event.type === "agent_end") {
				resolve();
			}
		});
	});

	let promptError: unknown = null;
	try {
		await agent.prompt(message);
	} catch (err) {
		promptError = err;
	}

	await finished;
	unsub?.();
	req.off("close", onClose);

	// Зберегти нові повідомлення (assistant + tool results) у сесію.
	if (promptError === null && !abortController.signal.aborted) {
		const finalMessages = agent.state.messages;
		for (let i = startCount; i < finalMessages.length; i++) {
			await sessions.appendMessage(sessionId, finalMessages[i]);
		}
	} else if (promptError !== null && !abortController.signal.aborted) {
		const errMsg = promptError instanceof Error ? promptError.message : String(promptError);
		writeSSE(res, { type: "error", message: errMsg });
	}

	res.end();
}

/** Записати SSE-подію. */
function writeSSE(res: ServerResponse, event: unknown): void {
	try {
		res.write(`data: ${JSON.stringify(event)}\n\n`);
	} catch {
		/* зʼєднання могло закритись */
	}
}
