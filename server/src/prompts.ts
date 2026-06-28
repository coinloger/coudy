/**
 * Системні промпт-шаблони: persisted CRUD + per-session привʼязка.
 *
 * Два файлові сховища (0o600, ~/.coudycode):
 *   prompts.json                     — { templates: [{ id, name, content, createdAt }] }
 *   session-prompt-templates.json    — { "<sessionId>": "<templateId>" } (null/відсутність = built-in)
 *
 * Пер-session привʼязка живе окремо від JSONL сесії (як auth) — простий map.
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";

/** Шаблон системного промпту. */
export interface PromptTemplate {
	id: string;
	name: string;
	content: string;
	createdAt: string;
}

/** Формат файлу prompts.json. */
interface PromptsFile {
	templates: PromptTemplate[];
}

/** Базова директорія coudycode (env COUDYCODE_DIR || ~/.coudycode). */
function getCoudyDir(): string {
	const fromEnv = process.env["COUDYCODE_DIR"];
	if (fromEnv && fromEnv.trim().length > 0) return fromEnv;
	return join(homedir(), ".coudycode");
}

const WRITE_OPTIONS = { encoding: "utf-8", mode: 0o600 } as const;

/** Створити батьківську директорію (0o700) + файл (0o600) за потреби. */
function ensureFile(filePath: string, initialContent: string): void {
	const dir = dirname(filePath);
	if (!existsSync(dir)) {
		mkdirSync(dir, { recursive: true, mode: 0o700 });
	}
	if (!existsSync(filePath)) {
		writeFileSync(filePath, initialContent, WRITE_OPTIONS);
		try {
			chmodSync(filePath, 0o600);
		} catch {
			/* chmod може не спрацювати на деяких ФС — ігноруємо */
		}
	}
}

/** Проста JSON persistence (read-modify-write). */
function readJson<T>(filePath: string, fallback: T): T {
	try {
		if (!existsSync(filePath)) return fallback;
		const raw = readFileSync(filePath, "utf-8").trim();
		if (!raw) return fallback;
		const parsed = JSON.parse(raw) as T;
		return parsed && typeof parsed === "object" ? parsed : fallback;
	} catch {
		return fallback;
	}
}

function writeJson(filePath: string, data: unknown): void {
	ensureFile(filePath, "{}");
	writeFileSync(filePath, JSON.stringify(data, null, 2), WRITE_OPTIONS);
	try {
		chmodSync(filePath, 0o600);
	} catch {
		/* див. вище */
	}
}

/**
 * Сховище шаблонів системних промптів: CRUD у prompts.json.
 */
export class PromptTemplateStore {
	private readonly path: string;

	constructor(path?: string) {
		this.path = path ?? join(getCoudyDir(), "prompts.json");
		ensureFile(this.path, JSON.stringify({ templates: [] }));
	}

	/** Усі шаблони (хронологічно по createdAt). */
	list(): PromptTemplate[] {
		const data = readJson<PromptsFile>(this.path, { templates: [] });
		return [...data.templates].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
	}

	/** Знайти шаблон за id. */
	get(id: string): PromptTemplate | undefined {
		return this.list().find((t) => t.id === id);
	}

	/** Створити шаблон. Валідація: name непорожнє. */
	create(name: string, content: string): PromptTemplate {
		const trimmedName = name.trim();
		if (!trimmedName) throw new Error("Потрібне поле name");
		const data = readJson<PromptsFile>(this.path, { templates: [] });
		const template: PromptTemplate = {
			id: randomUUID(),
			name: trimmedName,
			content,
			createdAt: new Date().toISOString(),
		};
		data.templates.push(template);
		writeJson(this.path, data);
		return template;
	}

	/** Оновити name/content шаблону. null якщо id не знайдено. */
	update(id: string, patch: { name?: string; content?: string }): PromptTemplate | null {
		const data = readJson<PromptsFile>(this.path, { templates: [] });
		const idx = data.templates.findIndex((t) => t.id === id);
		if (idx === -1) return null;
		if (typeof patch.name === "string") {
			const trimmed = patch.name.trim();
			if (!trimmed) throw new Error("name не може бути порожнім");
			data.templates[idx]!.name = trimmed;
		}
		if (typeof patch.content === "string") {
			data.templates[idx]!.content = patch.content;
		}
		writeJson(this.path, data);
		return data.templates[idx]!;
	}

	/** Видалити шаблон. Повертає true якщо видалено. */
	remove(id: string): boolean {
		const data = readJson<PromptsFile>(this.path, { templates: [] });
		const idx = data.templates.findIndex((t) => t.id === id);
		if (idx === -1) return false;
		data.templates.splice(idx, 1);
		writeJson(this.path, data);
		return true;
	}
}

/**
 * Per-session привʼязка шаблону: map sessionId → templateId (null = built-in).
 */
export class SessionPromptBinding {
	private readonly path: string;

	constructor(path?: string) {
		this.path = path ?? join(getCoudyDir(), "session-prompt-templates.json");
		ensureFile(this.path, "{}");
	}

	private readAll(): Record<string, string> {
		return readJson<Record<string, string>>(this.path, {});
	}

	private writeAll(data: Record<string, string>): void {
		writeJson(this.path, data);
	}

	/** templateId сесії (null = built-in / не обрано). */
	get(sessionId: string): string | null {
		return this.readAll()[sessionId] ?? null;
	}

	/** Зберегти привʼязку (null скидає до built-in — запис прибирається). */
	set(sessionId: string, templateId: string | null): void {
		const data = this.readAll();
		if (templateId === null) {
			delete data[sessionId];
		} else {
			data[sessionId] = templateId;
		}
		this.writeAll(data);
	}

	/** Прибрати привʼязки сесій до видаленого шаблону (cleanup). */
	removeByTemplate(templateId: string): void {
		const data = this.readAll();
		let changed = false;
		for (const sid of Object.keys(data)) {
			if (data[sid] === templateId) {
				delete data[sid];
				changed = true;
			}
		}
		if (changed) this.writeAll(data);
	}

	/** Прибрати привʼязку сесії (при видаленні сесії). */
	remove(sessionId: string): void {
		const data = this.readAll();
		if (sessionId in data) {
			delete data[sessionId];
			this.writeAll(data);
		}
	}
}
