/**
 * SSE-хендлери /api/chat та /api/sessions/:id/compact:
 * запускають AgentHarness (model + auth + tools + session) і стрімять AgentHarnessEvent.
 * AgentHarness автоматично персистить повідомлення + CompactionEntry у session JSONL.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import {
	AgentHarness,
	estimateContextTokens,
	shouldCompact,
	DEFAULT_COMPACTION_SETTINGS,
} from "@coudycode/agent-core/node";
import type { AgentEvent, AgentHarnessEvent, AgentTool } from "@coudycode/agent-core";
import { NodeExecutionEnv } from "@coudycode/agent-core/node";
import { getModel } from "@coudycode/ai";
import type { Model, Api } from "@coudycode/ai";
import { createAllTools } from "@coudycode/tools";
import type { Session } from "@coudycode/agent-core";
import { HookEngine } from "@coudycode/core";
import { SessionManager } from "./sessions.js";
import { AuthStorage } from "./auth/auth-storage.js";
import { ProviderDefinitions } from "./auth/provider-definitions.js";
import { PromptTemplateStore, SessionPromptBinding } from "./prompts.js";

const SYSTEM_PROMPT = "Ти — coudycode, корисний AI-асистент. Відповідай українською, стисло та по суті.";

/** Конфіг моделі для запуску агента. */
interface ResolvedModel {
	model: Model<Api>;
	apiKey: string;
}

/**
 * Резолвити модель + auth-ключ.
 * Пресет (built-in) → authStorage.getApiKey; кастомний (models.json) → apiKey + baseUrl.
 */
export async function resolveModelForChat(
	provider: string,
	modelId: string,
	auth: AuthStorage,
	defs: ProviderDefinitions,
): Promise<ResolvedModel | { error: string }> {
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

	const catalogModel = getModel(provider as never, modelId as never) as Model<Api> | undefined;
	if (!catalogModel) return { error: `Модель ${provider}/${modelId} не знайдена в каталозі` };
	const apiKey = await auth.getApiKey(provider);
	if (!apiKey) return { error: `Провайдер ${provider} не підключено — додайте ключ у Налаштуваннях` };
	return { model: catalogModel, apiKey };
}

/** Створити AgentHarness для сесії з резолвленою моделлю + auth + tools + промпт. */
async function createHarness(
	resolved: ResolvedModel,
	session: Session,
	cwd: string,
	hooks: HookEngine,
	basePrompt: string,
): Promise<AgentHarness> {
	const env = new NodeExecutionEnv({ cwd });
	// Базові інструменти → плагіни можуть додати свої через filter «tools:register».
	const baseTools = createAllTools(cwd);
	const tools = await hooks.applyFilters<AgentTool[]>("tools:register", baseTools);
	// Системний промпт: base = шаблон сесії ?? built-in → плагіни можуть модифікувати через «prompt:system».
	const systemPrompt = await hooks.applyFilters<string>("prompt:system", basePrompt);
	return new AgentHarness({
		env,
		session,
		model: resolved.model,
		tools: tools as never,
		systemPrompt,
		thinkingLevel: "off",
		getApiKeyAndHeaders: async () => ({ apiKey: resolved.apiKey }),
	});
}

/** Резолвити base-системний промпт сесії: шаблон ?? built-in SYSTEM_PROMPT. */
function resolveBasePrompt(
	sessionId: string,
	promptTemplates: PromptTemplateStore,
	promptBindings: SessionPromptBinding,
): string {
	const templateId = promptBindings.get(sessionId);
	if (templateId) {
		const template = promptTemplates.get(templateId);
		if (template) return template.content;
	}
	return SYSTEM_PROMPT;
}

/** Встановити SSE-заголовки. */
function initSSE(res: ServerResponse): void {
	res.writeHead(200, {
		"Content-Type": "text/event-stream",
		"Cache-Control": "no-cache",
		Connection: "keep-alive",
		"Access-Control-Allow-Origin": "*",
	});
}

/** Записати SSE-подію. */
function writeSSE(res: ServerResponse, event: unknown): void {
	try {
		res.write(`data: ${JSON.stringify(event)}\n\n`);
	} catch {
		/* зʼєднання могло закритись */
	}
}

/** /api/chat: prompt → стрім AgentEvent → авто-compact при наближенні до ліміту. */
export async function handleChat(
	req: IncomingMessage,
	res: ServerResponse,
	body: { sessionId?: unknown; message?: unknown },
	sessions: SessionManager,
	auth: AuthStorage,
	defs: ProviderDefinitions,
	currentModel: { provider: string; modelId: string } | null,
	cwd: string,
	hooks: HookEngine,
	promptTemplates: PromptTemplateStore,
	promptBindings: SessionPromptBinding,
): Promise<void> {
	initSSE(res);

	const sessionId = typeof body.sessionId === "string" ? body.sessionId : null;
	const message = typeof body.message === "string" ? body.message.trim() : null;

	if (!sessionId || !message) {
		writeSSE(res, { type: "error", message: "Потрібні поля sessionId та message" });
		res.end();
		return;
	}

	const opened = await sessions.openSession(sessionId);
	if (!opened) {
		writeSSE(res, { type: "error", message: "Сесію не знайдено" });
		res.end();
		return;
	}

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

	const harness = await createHarness(resolved, opened.session, cwd, hooks, resolveBasePrompt(sessionId, promptTemplates, promptBindings));

	// Скасування при disconnect.
	const onClose = (): void => {
		void harness.abort().catch(() => undefined);
	};
	req.on("close", onClose);

	// Стрімити всі події (включно session_compact при авто-compact).
	let unsub: (() => void) | undefined;
	const finished = new Promise<void>((resolve) => {
		unsub = harness.subscribe((event: AgentHarnessEvent) => {
			writeSSE(res, event);
			if (event.type === "agent_end") {
				resolve();
			}
		});
	});

	let promptError: unknown = null;
	try {
		// Action: плагіни можуть підготуватись ДО виклику LLM (payload: session/message/model).
		await hooks.doAction("agent:before-prompt", opened.session, message, resolved.model);
		await harness.prompt(message);
	} catch (err) {
		promptError = err;
	}

	await finished;
	unsub?.();
	req.off("close", onClose);

	// Action: плагіні можуть відреагувати на завершення відповіді (payload: session/model).
	if (promptError === null) {
		await hooks.doAction("agent:after-response", opened.session, resolved.model);
	}

	// Авто-compact при наближенні до ліміту (зберігається автоматично, стрімить session_compact).
	if (promptError === null) {
		try {
			const ctx = await opened.session.buildContext();
			const { tokens } = estimateContextTokens(ctx.messages);
			if (shouldCompact(tokens, resolved.model.contextWindow, DEFAULT_COMPACTION_SETTINGS)) {
				writeSSE(res, { type: "compaction_start" });
				const autoUnsub = harness.subscribe((event: AgentHarnessEvent) => writeSSE(res, event));
				await harness.compact();
				autoUnsub();
			}
		} catch {
			/* compact необовʼязковий */
		}
	} else {
		const errMsg = promptError instanceof Error ? promptError.message : String(promptError);
		writeSSE(res, { type: "error", message: errMsg });
	}

	res.end();
}

/** /api/sessions/:id/compact: ручна компактація → SSE з session_compact. */
export async function handleCompact(
	req: IncomingMessage,
	res: ServerResponse,
	body: { customInstructions?: unknown },
	sessions: SessionManager,
	auth: AuthStorage,
	defs: ProviderDefinitions,
	model: { provider: string; modelId: string } | null,
	cwd: string,
	hooks: HookEngine,
	promptTemplates: PromptTemplateStore,
	promptBindings: SessionPromptBinding,
): Promise<void> {
	initSSE(res);

	const sessionId = (() => {
		const m = /\/api\/sessions\/([^/]+)\/compact/.exec(req.url ?? "");
		return m ? decodeURIComponent(m[1]) : null;
	})();

	const opened = sessionId ? await sessions.openSession(sessionId) : null;
	if (!opened || !sessionId) {
		writeSSE(res, { type: "error", message: "Сесію не знайдено" });
		res.end();
		return;
	}

	if (!model) {
		writeSSE(res, { type: "error", message: "Оберіть модель у чаті" });
		res.end();
		return;
	}
	const resolved = await resolveModelForChat(model.provider, model.modelId, auth, defs);
	if ("error" in resolved) {
		writeSSE(res, { type: "error", message: resolved.error });
		res.end();
		return;
	}

	const harness = await createHarness(resolved, opened.session, cwd, hooks, resolveBasePrompt(sessionId, promptTemplates, promptBindings));
	const customInstructions =
		typeof body.customInstructions === "string" ? body.customInstructions : undefined;

	const onClose = (): void => {
		void harness.abort().catch(() => undefined);
	};
	req.on("close", onClose);

	const unsub = harness.subscribe((event: AgentHarnessEvent) => writeSSE(res, event));

	// Прогрес компактації: сповістити клієнт ДО виклику LLM (щоб чат не здавався завислим).
	writeSSE(res, { type: "compaction_start" });

	try {
		await harness.compact(customInstructions);
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		writeSSE(res, { type: "error", message: msg });
	}

	unsub();
	req.off("close", onClose);
	res.end();
}
