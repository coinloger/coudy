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
import { buildSystemPrompt } from "./system-prompt.js";
import {
  PluginSessionRegistryImpl,
  PluginSessionStore,
  resolvePluginOwnership,
} from "./plugin-sessions.js";
import type { PluginSessionOwnership } from "@coudycode/core";

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

/** Доступний тулз для UI (GET /api/tools). */
export interface ToolInfo {
	name: string;
	description?: string;
}

/**
 * Поточний глобальний набір тулзів: базові + активні плагін-тулзи
 * (hooks.applyFilters("tools:register", base)). Для UI-селектора тулзів шаблону.
 */
export async function getGlobalTools(cwd: string, hooks: HookEngine): Promise<ToolInfo[]> {
	const tools = await hooks.applyFilters<AgentTool[]>("tools:register", createAllTools(cwd));
	return tools.map((t) => ({ name: t.name, description: t.description }));
}

/** Створити AgentHarness для сесії з резолвленою моделлю + auth + tools + промпт. */
async function createHarness(
	resolved: ResolvedModel,
	session: Session,
	cwd: string,
	hooks: HookEngine,
	template: { content: string; tools: string[] | null } | null,
): Promise<AgentHarness> {
	const env = new NodeExecutionEnv({ cwd });
	// Базові інструменти + плагін-тулзи (через filter «tools:register»).
	let tools = await hooks.applyFilters<AgentTool[]>("tools:register", createAllTools(cwd));
	// Фільтр за toolset-ом шаблону ПІСЛЯ applyFilters → контролює всі тулзи (вкл. плагін):
	// null = усі; [] = без; [...] = лише ці (базові + плагін з цього списку).
	if (template && template.tools !== null) {
		const want = new Set(template.tools);
		tools = tools.filter((t) => want.has(t.name));
	}
	// Системний промпт: content шаблону ?? built-in (з поточним набором тулзів).
	const basePrompt = template
		? template.content
		: buildSystemPrompt({ cwd, tools: tools.map((t) => t.name) });
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

/**
 * Створити AgentHarness для PLUGIN-сесії: ІЗОЛЬОВАНИЙ конфіг.
 * Тулзи/промпт плагіна беруться з конфігу; глобальні хуки (tools:register/
 * prompt:system) НЕ застосовуються — забруднення неможливе структурно.
 * contextProvider викликається на кожен хід → свіжий фід у systemPrompt.
 */
async function createPluginHarness(
	resolved: ResolvedModel,
	session: Session,
	cwd: string,
	ownership: PluginSessionOwnership,
): Promise<AgentHarness> {
	const env = new NodeExecutionEnv({ cwd });
	const { config } = ownership;
	// Базові інструменти (read/bash/…) лише якщо inheritBaseTools !== false.
	const inheritBase = config.inheritBaseTools !== false;
	const baseTools = inheritBase ? createAllTools(cwd) : [];
	// Тулзи плагіна (без applyFilters — структурна ізоляція).
	const pluginTools = (config.tools ?? []) as AgentTool[];
	const tools = [...baseTools, ...pluginTools];
	// Системний промпт: плагіна ?? built-in; + contextProvider-фід цього ходу.
	const basePrompt = config.systemPrompt ?? buildSystemPrompt({ cwd });
	const systemPrompt = await injectContextProvider(basePrompt, config);
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

/** Впровадити contextProvider-фід у системний промпт як блок <plugin_context>. */
async function injectContextProvider(
	basePrompt: string,
	config: PluginSessionOwnership["config"],
): Promise<string> {
	if (!config.contextProvider) return basePrompt;
	let feed: unknown;
	try {
		feed = await config.contextProvider();
	} catch (e) {
		console.error("[plugin-sessions] contextProvider помилка:", e);
		return basePrompt;
	}
	const text = typeof feed === "string" ? feed : JSON.stringify(feed, null, 2);
	if (!text.trim()) return basePrompt;
	return `${basePrompt}\n\n<plugin_context>\n${text}\n</plugin_context>`;
}

/**
 * Резолвити шаблон сесії: {content, tools} або null (built-in).
 * content — системний промпт; tools — набір тулзів шаблону (null=усі, []=без, [...]=ці).
 */
function resolveTemplate(
	sessionId: string,
	promptTemplates: PromptTemplateStore,
	promptBindings: SessionPromptBinding,
): { content: string; tools: string[] | null } | null {
	const templateId = promptBindings.get(sessionId);
	if (!templateId) return null;
	const template = promptTemplates.get(templateId);
	if (!template) return null;
	return { content: template.content, tools: template.tools ?? null };
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
	pluginSessionRegistry: PluginSessionRegistryImpl,
	pluginSessionStore: PluginSessionStore,
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

	// Структурна ізоляція: plugin-сесія має власний конфіг (без глобальних хуків).
	const ownership = resolvePluginOwnership(sessionId, pluginSessionRegistry, pluginSessionStore);
	const harness = ownership
		? await createPluginHarness(resolved, opened.session, cwd, ownership)
		: await createHarness(
				resolved,
				opened.session,
				cwd,
				hooks,
				resolveTemplate(sessionId, promptTemplates, promptBindings),
			);

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
	pluginSessionRegistry: PluginSessionRegistryImpl,
	pluginSessionStore: PluginSessionStore,
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

	const ownership = resolvePluginOwnership(sessionId, pluginSessionRegistry, pluginSessionStore);
	const harness = ownership
		? await createPluginHarness(resolved, opened.session, cwd, ownership)
		: await createHarness(resolved, opened.session, cwd, hooks, resolveTemplate(sessionId, promptTemplates, promptBindings));
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
