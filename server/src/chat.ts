/**
 * SSE-хендлери /api/chat та /api/sessions/:id/compact:
 * запускають AgentHarness (model + auth + tools + session) і стрімять AgentHarnessEvent.
 * AgentHarness автоматично персистить повідомлення + CompactionEntry у session JSONL.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import {
	AgentHarness,
	estimateContextTokens,
} from "@coudycode/agent-core/node";
import type { AgentEvent, AgentHarnessEvent, AgentTool } from "@coudycode/agent-core";
import { NodeExecutionEnv } from "@coudycode/agent-core/node";
import { getModel } from "@coudycode/ai";
import { completeSimple, type Model, type Api, type ImageContent, type Context } from "@coudycode/ai";
import { createAllTools, wrapToolDefinition } from "@coudycode/tools";
import type { ToolDefinition } from "@coudycode/tools";
import { Type, type Static } from "typebox";
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
import { processRegistry } from "./processes.js";
import { ChatSettingsStore } from "./chat-settings.js";

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

/** Дефолтна назва сесії (ознака «ще не названо»). */
const DEFAULT_SESSION_TITLES = new Set(["Новий чат", ""]);

/** Евристична назва: перші ~6 слів першого повідомлення користувача (clean). */
function heuristicTitle(userMessage: string): string {
	const clean = userMessage.replace(/\s+/g, " ").trim();
	if (!clean) return "Новий чат";
	const words = clean.split(" ").slice(0, 6).join(" ");
	// Обрізати занадто довгий хвіст (опецьки/команди).
	return words.length > 50 ? `${words.slice(0, 50).trim()}…` : words;
}

/**
 * Згенерувати коротку назву чату (3-6 слів, укр) через легкий LLM-completion.
 * БЕЗ тулзів, короткий промпт. Повертає назву або null при помилці/відмові.
 */
async function llmChatTitle(
	resolved: ResolvedModel,
	userMessage: string,
	assistantText: string,
): Promise<string | null> {
	const sys = "Ти генератор коротких назв чатів. Дай стислу назву (3-6 слів, українською) для цього діалогу користувача з AI-асистентом. ТІЛЬКИ саму назву, без лапок, без крапки в кінці, без префіксів на кшталт «Назва:».";
	// Компактний діалог: лише суть (обрізаємо довгі тексти, щоб зекономити токени).
	const userSnippet = userMessage.slice(0, 800);
	const asstSnippet = assistantText.slice(0, 400);
	const ctx: Context = {
		systemPrompt: sys,
		messages: [
			{ role: "user", content: `Користувач: ${userSnippet}\n\nАсистент (початок): ${asstSnippet}`, timestamp: Date.now() },
		],
	};
	try {
		const result = await completeSimple(resolved.model, ctx, {
			apiKey: resolved.apiKey,
			maxTokens: 30,
			temperature: 0.3,
		});
		if (result.stopReason === "error" || result.stopReason === "aborted") return null;
		const text = result.content
			.filter((c): c is { type: "text"; text: string } => c.type === "text")
			.map((c) => c.text)
			.join("")
			.trim();
		if (!text) return null;
		// Прибрати зайві лапки/крапки/префікси які LLM іноді додає.
		let clean = text.replace(/^["«»'«»']+|["«»'«»']+$/g, "").trim();
		clean = clean.replace(/^(назва|title)\s*[:.]\s*/i, "").trim();
		clean = clean.replace(/[.!?]+$/g, "").trim();
		// Обмежити довжину (LLM може розмовитись).
		if (clean.length > 60) clean = `${clean.slice(0, 60).trim()}…`;
		return clean || null;
	} catch {
		return null;
	}
}

/**
 * Витягти текст з AgentMessage (assistant content — масив TextContent/...).
 */
function assistantMessageText(msg: { content: unknown } | undefined | null): string {
	if (!msg) return "";
	const content = msg.content;
	if (typeof content === "string") return content;
	if (Array.isArray(content)) {
		return content
			.map((c) =>
				c && typeof c === "object" && "text" in c && typeof (c as { text?: unknown }).text === "string"
				? (c as { text: string }).text
				: "",
			)
			.join("");
	}
	return "";
}

/** Доступний тулз для UI (GET /api/tools). */
export interface ToolInfo {
	name: string;
	description?: string;
	label: string;
	/** Група: «standard» = базові; інакше — id плагіна. */
	group: string;
}

/**
 * Поточний глобальний набір тулзів: базові + активні плагін-тулзи
 * (hooks.applyFilters("tools:register", base)). Для UI-селектора тулзів шаблону.
 */
export async function getGlobalTools(cwd: string, hooks: HookEngine): Promise<ToolInfo[]> {
	// Базові тулзи + processes-тулз; плагіни додають свої через filter «tools:register».
	const base = [...createAllTools(cwd), createProcessesTool()];
	const tools = await hooks.applyFilters<AgentTool[]>("tools:register", base, { sessionId: "__global__", cwd });
	return tools.map((t) => ({
		name: t.name,
		description: t.description,
		label: t.label ?? t.name,
		group: t.group ?? "standard",
	}));
}

/**
 * Agent-тулз «processes»: список живих процесів + вбивство одного.
 * Працює через глобальний singleton-реєстр (див. processes.ts).
 */
export function createProcessesTool(): AgentTool {
	const processesSchema = Type.Object({
		action: Type.Union([Type.Literal("list"), Type.Literal("kill")], {
			description: "list — показати живі процеси; kill — зупинити процес за pid.",
		}),
		pid: Type.Optional(
			Type.Number({ description: "pid процесу для kill (з результату list). Ігнорується для list." }),
		),
	});
	const def: ToolDefinition<typeof processesSchema> = {
		name: "processes",
		label: "processes",
		description:
			"Переглянути живі процеси, спавнені через bash (вкл. фонові), або вбити одне дерево процесів за pid. " +
			"Використовуй action: 'list' щоб побачити поточні процеси, action: 'kill' з pid — щоб зупинити.",
		promptSnippet: "List/kill agent-spawned background processes",
		parameters: processesSchema,
		async execute(_id, params: Static<typeof processesSchema>) {
			if (params.action === "kill") {
				if (typeof params.pid !== "number") {
					throw new Error("Для action 'kill' потрібен pid (число).");
				}
				const ok = processRegistry.kill(params.pid);
				return {
					content: [
						{ type: "text", text: ok ? `Процес ${params.pid} зупинено.` : `Процес ${params.pid} не знайдено в реєстрі.` },
					],
					details: undefined,
				};
			}
			const list = processRegistry.list();
			if (list.length === 0) {
				return { content: [{ type: "text", text: "Жодного живого процесу." }], details: undefined };
			}
			const lines = list.map(
				(p) =>
					`pid=${p.pid} status=${p.status} age=${Math.round(p.ageMs / 1000)}s cwd=${p.cwd} :: ${p.command}`,
			);
			return { content: [{ type: "text", text: `Живі процеси (${list.length}):\n${lines.join("\n")}` }], details: undefined };
		},
	};
	return wrapToolDefinition(def);
}

/**
 * Базові тулзи + processes-тулз з підключеним реєстром процесів (spawnHook-и).
 * Анти-сирота: onSpawn реєструє; onComplete позначає фоновими або прибирає.
 */
function createTrackedTools(cwd: string, sessionId: string): AgentTool[] {
	return [
		...createAllTools(cwd, {
			bash: {
				onSpawn: ({ pid, pgid, command, cwd: toolCwd }) =>
					processRegistry.register({ pid, pgid, command, cwd: toolCwd, startedAt: Date.now(), sessionId, status: "running" }),
				onComplete: ({ pid }) => processRegistry.markBackgroundIfAlive(pid),
			},
		}),
		createProcessesTool(),
	];
}

/** Створити AgentHarness для сесії з резолвленою моделлю + auth + tools + промпт. */
async function createHarness(
	resolved: ResolvedModel,
	session: Session,
	cwd: string,
	sessionId: string,
	hooks: HookEngine,
	template: { content: string; tools: string[] | null } | null,
): Promise<AgentHarness> {
	const env = new NodeExecutionEnv({ cwd });
	// Базові інструменти (з реєстром процесів) + processes-тулз + плагін-тулзи.
	let tools = await hooks.applyFilters<AgentTool[]>("tools:register", createTrackedTools(cwd, sessionId), { sessionId, cwd });
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
	sessionId: string,
	ownership: PluginSessionOwnership,
): Promise<AgentHarness> {
	const env = new NodeExecutionEnv({ cwd });
	const { config } = ownership;
	// Базові інструменти (з реєстром процесів) лише якщо inheritBaseTools !== false.
	const inheritBase = config.inheritBaseTools !== false;
	const baseTools = inheritBase ? createTrackedTools(cwd, sessionId) : [];
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

/** Per-session lock для чат-запуску (фоновий агент; дубль-старт → 409). */
export interface ChatLock {
	tryStart(sessionId: string, abort: () => void): boolean;
	finish(sessionId: string): void;
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

/** Записати SSE-подію. Безпечно після відвалу клієнта (guard writableEnded/destroyed). */
function writeSSE(res: ServerResponse, event: unknown): void {
	try {
		if (res.writableEnded || res.destroyed) return;
		res.write(`data: ${JSON.stringify(event)}\n\n`);
	} catch {
		/* зʼєднання могло закритись */
	}
}

/** /api/chat: prompt → стрім AgentEvent → авто-compact при наближенні до ліміту. */
export async function handleChat(
	req: IncomingMessage,
	res: ServerResponse,
	body: { sessionId?: unknown; message?: unknown; images?: unknown[] },
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
	chatSettings: ChatSettingsStore,
	lock: ChatLock,
): Promise<void> {
	initSSE(res);

	const sessionId = typeof body.sessionId === "string" ? body.sessionId : null;
	const message = typeof body.message === "string" ? body.message.trim() : null;
	// Зображення (base64 ImageContent[]) — опціонально; валідуємо лише масив обʼєктів {type:"image"}.
	const rawImages = Array.isArray(body.images) ? body.images : [];
	const images = rawImages.filter(
		(i: unknown): i is ImageContent =>
			typeof i === "object" &&
			i !== null &&
			(i as { type?: unknown }).type === "image" &&
			typeof (i as { data?: unknown }).data === "string" &&
			typeof (i as { mimeType?: unknown }).mimeType === "string",
	);

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
		? await createPluginHarness(resolved, opened.session, cwd, sessionId, ownership)
		: await createHarness(
				resolved,
				opened.session,
				cwd,
				sessionId,
				hooks,
				resolveTemplate(sessionId, promptTemplates, promptBindings),
			);

	// Per-session lock: заборонити дубль-старт тієї ж сесії (409 «session busy»).
	if (!lock.tryStart(sessionId, () => void harness.abort().catch(() => undefined))) {
		writeSSE(res, { type: "error", message: "Сесія вже виконується — дочекайтесь завершення або зупиніться" });
		res.end();
		return;
	}
	// ГАРЯЧЕ ВАЖЛИВО: disconnect клієнта НЕ вбиває run — фоновий агент доробляє сам,
	// пише в JSONL. SSE-записи захищені (writeSSE перевіряє writableEnded/destroyed).
	try {
		// Стрімити всі події (включно session_compact при авто-compact).
		let unsub: (() => void) | undefined;
		const finished = new Promise<void>((resolve) => {
			unsub = harness.subscribe((event: AgentHarnessEvent) => {
			writeSSE(res, event);
			if (event.type === "agent_end") {
				// Логувати помилки моделі/провайдера в dev.log (діагностика замість «мовчання»).
				const last = event.messages[event.messages.length - 1];
				if (last && last.role === "assistant" && last.stopReason === "error" && last.errorMessage) {
					console.error(
						`[chat] Помилка відповіді (${last.provider}/${last.model}): ${last.errorMessage}`,
					);
				}
				resolve();
			}
		});
	});

	let promptError: unknown = null;
	try {
		// Action: плагіни можуть підготуватись ДО виклику LLM (payload: session/message/model).
		// (skill-library скидає search-flow у своєму tools:register фільтрі.)
		await hooks.doAction("agent:before-prompt", opened.session, message, resolved.model);
		await harness.prompt(message, images.length ? { images } : undefined);
	} catch (err) {
		promptError = err;
	}

	await finished;
	unsub?.();

	// Action: плагіні можуть відреагувати на завершення відповіді (payload: session/model).
	if (promptError === null) {
		await hooks.doAction("agent:after-response", opened.session, resolved.model);
	}

	// Авто-назва чату: після ПЕРШОГО ходу, якщо title ще дефолтний/порожній →
	// згенерувати назву + емітнути session:title. Працює ЗАВЖДИ (базується на
	// user-повідомленні): при успішній відповіді — LLM-completion, при помилці
	// моделі (promptError) — одразу heuristic-fallback (перші слова повідомлення).
	// SSE ще відкритий → клієнт (ChatView + sidebar) оновиться живцем.
	try {
		const currentName = await opened.session.getSessionName();
		const needsTitle = !currentName || DEFAULT_SESSION_TITLES.has(currentName);
		if (needsTitle) {
			const ctx = await opened.session.buildContext();
			// Лише перший хід: рахуємо повідомлення користувача (вкл. те, що щойно відправили).
			const userCount = ctx.messages.filter((m) => m.role === "user").length;
			if (userCount <= 1) {
				// LLM-назву кличемо лише при успішній відповіді; при помилці моделі — одразу евристика.
				let title: string | null = null;
				if (promptError === null) {
					const asstText = assistantMessageText(
						[...ctx.messages].reverse().find((m) => m.role === "assistant"),
					);
					title = await llmChatTitle(resolved, message, asstText);
				}
				if (!title) title = heuristicTitle(message);
				if (title && !DEFAULT_SESSION_TITLES.has(title)) {
					await sessions.rename(sessionId, title);
					writeSSE(res, { type: "session:title", sessionId, title });
				}
			}
		}
	} catch {
		/* авто-назва необовʼязкова — не ламати стрім */
	}

	// Авто-compact при досягненні відсоткового порогу contextWindow (зберігається автоматично,
	// стрімить session_compact). Поріг + toggle — з chat-settings (default 80%).
	if (promptError === null) {
		try {
			const settings = chatSettings.get();
			if (settings.autoCompact) {
				const ctx = await opened.session.buildContext();
				const { tokens } = estimateContextTokens(ctx.messages);
				const threshold = Math.floor(resolved.model.contextWindow * (settings.compactThresholdPct / 100));
				if (tokens >= threshold) {
					writeSSE(res, { type: "compaction_start" });
					const autoUnsub = harness.subscribe((event: AgentHarnessEvent) => writeSSE(res, event));
					await harness.compact();
					autoUnsub();
				}
			}
		} catch {
			/* compact необовʼязковий */
		}
	} else {
		const errMsg = promptError instanceof Error ? promptError.message : String(promptError);
		writeSSE(res, { type: "error", message: errMsg });
	}

		res.end();
	} finally {
		lock.finish(sessionId);
	}
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
		? await createPluginHarness(resolved, opened.session, cwd, sessionId, ownership)
		: await createHarness(resolved, opened.session, cwd, sessionId, hooks, resolveTemplate(sessionId, promptTemplates, promptBindings));
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
