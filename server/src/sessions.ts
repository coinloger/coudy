/**
 * Менеджер сесій поверх agent-core JSONL-репозиторію.
 * Сесії персистяться в ~/.coudycode/sessions/ (env COUDYCODE_DIR).
 * Айді — UUIDv7 (agent-core). Модель зберігається per-session (запис model_change).
 */
import { join } from "node:path";
import { homedir } from "node:os";
import { JsonlSessionRepo, estimateContextTokens, buildDisplayMessages } from "@coudycode/agent-core";
import type { AgentMessage, JsonlSessionMetadata } from "@coudycode/agent-core";
import { NodeExecutionEnv } from "@coudycode/agent-core/node";

/** Модель сесії. */
export interface SessionModel {
	provider: string;
	modelId: string;
	label: string;
	contextWindow: number;
}

/** Використання контекстного вікна. */
export interface ContextUsage {
	tokensUsed: number;
	contextWindow: number;
	pct: number;
}

/** Публічне представлення сесії (метадані + лічильник + модель + контекст). */
export interface SessionSummary {
	id: string;
	name: string | null;
	createdAt: string;
	updatedAt: string;
	messageCount: number;
	model: SessionModel | null;
	contextUsage: ContextUsage | null;
	/** Імʼя плагіна-власника (для plugin-owned сесій; null = юзерський чат). */
	plugin?: string | null;
	/** Plugin-scoped id сесії (для plugin-owned сесій). */
	pluginSessionId?: string | null;
}

/** Повна сесія (метадані + повідомлення). */
export interface SessionFull extends SessionSummary {
	messages: unknown[];
	/** Обраний системний-промпт шаблон сесії (null = built-in SYSTEM_PROMPT). */
	promptTemplate: { id: string; name: string } | null;
}

/** Базова директорія coudycode (env COUDYCODE_DIR || ~/.coudycode). */
function getCoudyDir(): string {
	const fromEnv = process.env["COUDYCODE_DIR"];
	if (fromEnv && fromEnv.trim().length > 0) return fromEnv;
	return join(homedir(), ".coudycode");
}

	/** Опції SessionManager (для резолву моделі/label з підключених). */
export interface SessionManagerOptions {
	/** Знайти підключену модель за {provider, modelId} → SessionModel (null якщо не підключена/невалідна). */
	resolveConnectedModel?: (provider: string, modelId: string) => SessionModel | null;
	/** Список усіх підключених моделей (для дефолту нової сесії). */
	listConnectedModels?: () => SessionModel[];
	/** templateId сесії (null = built-in SYSTEM_PROMPT). */
	getPromptTemplateId?: (sessionId: string) => string | null;
	/** Знайти шаблон за id → {id, name} (для поля promptTemplate сесії). */
	resolvePromptTemplate?: (templateId: string) => { id: string; name: string } | null;
	/** Власність plugin-сесії за realSessionUuid (для полів plugin/pluginSessionId). */
	resolveOwnership?: (sessionId: string) => { pluginName: string; pluginSessionId: string } | null;
}

/**
 * Менеджер сесій: обгортка над JsonlSessionRepo, що повертає публічні метадані
 * (name/model/updatedAt/messageCount). Модель зберігається per-session (JSONL).
 */
export class SessionManager {
	private readonly repo: JsonlSessionRepo;
	private readonly cwd: string;
	private readonly resolveConnectedModel?: SessionManagerOptions["resolveConnectedModel"];
	private readonly listConnectedModels?: SessionManagerOptions["listConnectedModels"];
	private readonly getPromptTemplateId?: SessionManagerOptions["getPromptTemplateId"];
	private readonly resolvePromptTemplate?: SessionManagerOptions["resolvePromptTemplate"];
	private readonly resolveOwnership?: SessionManagerOptions["resolveOwnership"];

	constructor(options: SessionManagerOptions = {}) {
		this.cwd = process.cwd();
		const env = new NodeExecutionEnv({ cwd: this.cwd });
		this.repo = new JsonlSessionRepo({ fs: env, sessionsRoot: join(getCoudyDir(), "sessions") });
		this.resolveConnectedModel = options.resolveConnectedModel;
		this.listConnectedModels = options.listConnectedModels;
		this.getPromptTemplateId = options.getPromptTemplateId;
		this.resolvePromptTemplate = options.resolvePromptTemplate;
		this.resolveOwnership = options.resolveOwnership;
	}

	/** Створити нову сесію (UUIDv7 id). Опц. імʼя. Встановлює початкову модель (першу підключену). */
	async create(name?: string): Promise<SessionSummary> {
		const session = await this.repo.create({ cwd: this.cwd });
		if (name) {
			await session.appendSessionName(name);
		}
		// Початкова модель: перша підключена (якщо є).
		const initial = this.listConnectedModels?.()?.[0] ?? null;
		if (initial) {
			await session.appendModelChange(initial.provider, initial.modelId);
		}
		const meta = await session.getMetadata();
		const entries = await session.getEntries();
		const ctx = await session.buildContext();
		return this.summarize(meta, name ?? null, entries, ctx.model, ctx.messages);
	}

	/** Список усіх сесій (без повідомлень). */
	async list(): Promise<SessionSummary[]> {
		const metas = await this.repo.list({});
		const summaries: SessionSummary[] = [];
		for (const meta of metas) {
			try {
				const session = await this.repo.open(meta);
				const name = await session.getSessionName();
				const entries = await session.getEntries();
				const ctx = await session.buildContext();
				summaries.push(this.summarize(meta, name ?? null, entries, ctx.model, ctx.messages));
			} catch {
				// пошкоджену сесію пропускаємо
			}
		}
		return summaries;
	}

	/** Повна сесія (з повідомленнями). */
	async get(id: string): Promise<SessionFull | null> {
		const meta = await this.findMeta(id);
		if (!meta) return null;
		const session = await this.repo.open(meta);
		const name = await session.getSessionName();
		const ctx = await session.buildContext();
		const entries = await session.getEntries();
		// UI-повідомлення: хронологічний порядок (compaction на своїй позиції).
		// ctx.messages (LLM порядок, compaction згори) лишається для підрахунку токенів.
		const displayMessages = buildDisplayMessages(entries);
		const promptTemplate = this.resolveSessionPromptTemplate(id);
		return { ...this.summarize(meta, name ?? null, entries, ctx.model, ctx.messages), messages: displayMessages, promptTemplate };
	}

	/** Перейменувати сесію (запис session_info). */
	async rename(id: string, name: string): Promise<SessionSummary | null> {
		const meta = await this.findMeta(id);
		if (!meta) return null;
		const session = await this.repo.open(meta);
		await session.appendSessionName(name);
		const entries = await session.getEntries();
		const ctx = await session.buildContext();
		return this.summarize(meta, name, entries, ctx.model, ctx.model ? ctx.messages : []);
	}

	/**
	 * Зберегти модель сесії (запис model_change). Валідація: модель має бути підключеною
	 * (через resolveConnectedModel, якщо задано). Повертає оновлений summary або null.
	 */
	async setModel(id: string, provider: string, modelId: string): Promise<SessionSummary | null> {
		const meta = await this.findMeta(id);
		if (!meta) return null;
		if (this.resolveConnectedModel) {
			const resolved = this.resolveConnectedModel(provider, modelId);
			if (!resolved) return null; // не підключена / невалідна
		}
		const session = await this.repo.open(meta);
		await session.appendModelChange(provider, modelId);
		const entries = await session.getEntries();
		const ctx = await session.buildContext();
		return this.summarize(meta, null, entries, ctx.model, ctx.messages);
	}

	/** Видалити сесію (і файл). */
	async delete(id: string): Promise<boolean> {
		const meta = await this.findMeta(id);
		if (!meta) return false;
		await this.repo.delete(meta);
		return true;
	}

	/** Прочитати повідомлення сесії (AgentMessage[]). */
	async getMessages(id: string): Promise<AgentMessage[] | null> {
		const meta = await this.findMeta(id);
		if (!meta) return null;
		const session = await this.repo.open(meta);
		const ctx = await session.buildContext();
		return ctx.messages;
	}

	/** Додати повідомлення у сесію (зберігає у JSONL). */
	async appendMessage(id: string, message: AgentMessage): Promise<boolean> {
		const meta = await this.findMeta(id);
		if (!meta) return false;
		const session = await this.repo.open(meta);
		await session.appendMessage(message);
		return true;
	}

	/**
	 * Відкрити сесію як обʼєкт Session (agent-core) — для AgentHarness.
	 * Повертає { session, messages } або null, якщо сесії нема.
	 */
	async openSession(id: string): Promise<{
		session: Awaited<ReturnType<JsonlSessionRepo["open"]>>;
		messages: AgentMessage[];
	} | null> {
		const meta = await this.findMeta(id);
		if (!meta) return null;
		const session = await this.repo.open(meta);
		const ctx = await session.buildContext();
		return { session, messages: ctx.messages };
	}

	/** Знайти метадані за id (list + фільтр). */
	private async findMeta(id: string): Promise<JsonlSessionMetadata | undefined> {
		const metas = await this.repo.list({});
		return metas.find((m) => m.id === id);
	}

	/** Привести метадані + записи + модель + повідомлення до публічного summary. */
	private summarize(
		meta: JsonlSessionMetadata,
		name: string | null,
		entries: unknown[],
		model: { provider: string; modelId: string } | null,
		messages: AgentMessage[],
	): SessionSummary {
		const messageCount = entries.filter((e) => (e as { type?: string }).type === "message").length;
		const last = entries[entries.length - 1] as { timestamp?: string } | undefined;
		const sessionModel = model ? this.resolveSessionModel(model.provider, model.modelId) : null;
		const ownership = this.resolveOwnership?.(meta.id) ?? null;
		return {
			id: meta.id,
			name,
			createdAt: meta.createdAt,
			updatedAt: last?.timestamp ?? meta.createdAt,
			messageCount,
			model: sessionModel,
			contextUsage: this.computeContextUsage(messages, sessionModel),
			plugin: ownership?.pluginName ?? null,
			pluginSessionId: ownership?.pluginSessionId ?? null,
		};
	}

	/** Обчислити використання контексту: tokens/contextWindow. */
	private computeContextUsage(messages: AgentMessage[], model: SessionModel | null): ContextUsage | null {
		try {
			const { tokens } = estimateContextTokens(messages);
			const contextWindow = model?.contextWindow ?? 128000;
			const pct = contextWindow > 0 ? (tokens / contextWindow) * 100 : 0;
			return { tokensUsed: tokens, contextWindow, pct };
		} catch {
			return null;
		}
	}

	/** Резолвити label для моделі сесії (через resolveConnectedModel або fallback на modelId). */
	private resolveSessionModel(provider: string, modelId: string): SessionModel {
		const resolved = this.resolveConnectedModel?.(provider, modelId);
		if (resolved) return resolved;
		return { provider, modelId, label: modelId, contextWindow: 128000 };
	}

	/** Резолвити {id, name} шаблону сесії (через привʼязку + resolvePromptTemplate). */
	private resolveSessionPromptTemplate(sessionId: string): { id: string; name: string } | null {
		const templateId = this.getPromptTemplateId?.(sessionId) ?? null;
		if (!templateId) return null;
		return this.resolvePromptTemplate?.(templateId) ?? null;
	}
}
