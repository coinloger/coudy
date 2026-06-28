/**
 * Менеджер сесій поверх agent-core JSONL-репозиторію.
 * Сесії персистяться в ~/.coudycode/sessions/ (env COUDYCODE_DIR).
 * Айді — UUIDv7 (agent-core).
 */
import { join } from "node:path";
import { homedir } from "node:os";
import { JsonlSessionRepo } from "@coudycode/agent-core";
import type { AgentMessage, JsonlSessionMetadata } from "@coudycode/agent-core";
import { NodeExecutionEnv } from "@coudycode/agent-core/node";

/** Публічне представлення сесії (метадані + лічильник). */
export interface SessionSummary {
	id: string;
	name: string | null;
	createdAt: string;
	updatedAt: string;
	messageCount: number;
}

/** Повна сесія (метадані + повідомлення). */
export interface SessionFull extends SessionSummary {
	messages: unknown[];
}

/** Базова директорія coudycode (env COUDYCODE_DIR || ~/.coudycode). */
function getCoudyDir(): string {
	const fromEnv = process.env["COUDYCODE_DIR"];
	if (fromEnv && fromEnv.trim().length > 0) return fromEnv;
	return join(homedir(), ".coudycode");
}

/**
 * Менеджер сесій: тонка обгортка над JsonlSessionRepo, що повертає публічні
 * метадані (name/updatedAt/messageCount) замість внутрішніх.
 */
export class SessionManager {
	private readonly repo: JsonlSessionRepo;
	private readonly cwd: string;

	constructor() {
		this.cwd = process.cwd();
		const env = new NodeExecutionEnv({ cwd: this.cwd });
		this.repo = new JsonlSessionRepo({ fs: env, sessionsRoot: join(getCoudyDir(), "sessions") });
	}

	/** Створити нову сесію (UUIDv7 id). Опц. імʼя. */
	async create(name?: string): Promise<SessionSummary> {
		const session = await this.repo.create({ cwd: this.cwd });
		if (name) {
			await session.appendSessionName(name);
		}
		const meta = await session.getMetadata();
		const entries = await session.getEntries();
		return this.summarize(meta, name ?? null, entries);
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
				summaries.push(this.summarize(meta, name ?? null, entries));
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
		return { ...this.summarize(meta, name ?? null, entries), messages: ctx.messages };
	}

	/** Перейменувати сесію (запис session_info). */
	async rename(id: string, name: string): Promise<SessionSummary | null> {
		const meta = await this.findMeta(id);
		if (!meta) return null;
		const session = await this.repo.open(meta);
		await session.appendSessionName(name);
		const entries = await session.getEntries();
		return this.summarize(meta, name, entries);
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

	/** Знайти метадані за id (list + фільтр). */
	private async findMeta(id: string): Promise<JsonlSessionMetadata | undefined> {
		const metas = await this.repo.list({});
		return metas.find((m) => m.id === id);
	}

	/** Привести метадані + записи до публічного summary (updatedAt = останній запис). */
	private summarize(
		meta: JsonlSessionMetadata,
		name: string | null,
		entries: unknown[],
	): SessionSummary {
		const messageCount = entries.filter((e) => (e as { type?: string }).type === "message").length;
		const last = entries[entries.length - 1] as { timestamp?: string } | undefined;
		return {
			id: meta.id,
			name,
			createdAt: meta.createdAt,
			updatedAt: last?.timestamp ?? meta.createdAt,
			messageCount,
		};
	}
}
