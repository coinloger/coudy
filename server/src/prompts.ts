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
import { buildSystemPrompt } from "./system-prompt.js";

/** Шаблон системного промпту. */
export interface PromptTemplate {
	id: string;
	name: string;
	content: string;
	createdAt: string;
	/**
	 * Набір інструментів агента для цього шаблону (per-template toolset):
	 * - null (дефолт) → усі базові інструменти;
	 * - [] → без інструментів (агент лише текст);
	 * - ["read","grep",…] → лише ці.
	 */
	tools?: string[] | null;
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

/** Побудувати статичний coding-промпт для шаблону «Coding» (без динамічної date/cwd). */
function staticCodingPrompt(): string {
	// buildSystemPrompt вставляє поточну date/cwd — для шаблону лишаємо суть
	// (base + tools + guidelines); date/cwd допишуться фіксованими плейсхолдерами.
	const dynamic = buildSystemPrompt({ cwd: "." });
	return dynamic.replace(/\nCurrent date: .*\nCurrent working directory: .*/, "\n(Current date та working directory підставляються динамічно.)");
}

/** Готові шаблони з pi (засіваються при першому запуску, якщо store порожній). */
function getDefaultTemplates(): PromptTemplate[] {
	return [
		{
			id: randomUUID(),
			name: "Бібліотека",
			content: [
				"Ти маєш глобальну бібліотеку функцій (skill library) — набір перевикористовуваних параметризованих функцій.",
				"",
				"## ОБОВʼЯЗКОВИЙ FLOW",
				"Перед тим як щось робити — СПЕРШУ виконай `library_search` з описом задачі. Можливо потрібна функція вже існує.",
				"- Знайдено? → виклич `library_call(name, params)` з реальними параметрами.",
				"- Не знайдено? → лише тоді створюй нову через `library_create`.",
				"- `library_create` ВІДХИЛЯЄТЬСЯ якщо ти не зробив `library_search` у цьому ході.",
				"",
				"## Як писати нові функції",
				"- ЗАГАЛЬНІ та параметризовані (НЕ хардкодь конкретні значення з задачі). Напр. `delete_contract(addr)` а не `delete_my_contract()`.",
				"- Опис має бути конкретним — він індексується для семантичного пошуку.",
				"- Теги допомагають пошуку.",
				"",
				"## Композиція",
				"Функції можуть викликати інші методи бібліотеки через `ctx.call(name, params)`. Будуй складну логіку з простих перевикористовуваних блоків.",
				"Доступні core-примітиви в ctx: ctx.fs (read/write/json), ctx.sh (shell-out: python/sqlite3/go), ctx.proc (процеси), ctx.db (sqlite path), ctx.path.",
				"",
				"## Сесійні скрипти (3-рівнева модель)",
				"Два рівні сфери: **Global Library** (загальне, між сесіями) та **Session Scripts** (задачоспецифічні «чорновики», живуть з сесією).",
				"- Для задачоспецифічного/разового пиши `session_script_create` (БЕЗ вимоги search).",
				"- Якщо сесійний скрипт виявився загальним — `promote_to_global(name)` опублікує його в глобал (обходить search-flow).",
				"- Глобал лишай ЗАГАЛЬНИМ, чорновики — у session. НЕ засмічуй глобал специфічним.",
				"- Сесійний скрипт через `ctx.call` має доступ і до session, і до global (session→global).",
				"",
				"## Формат модуля",
				"export const meta = { name, description, params, tags };",
				"export async function run(params, ctx) { /* тіло */ return result; }",
				"",
				"## Мета",
				"Думай СУТНОСТЯМИ (імʼя + контракт + params), а не потоком символів. Будуй бібліотеку, що росте з кожною задачею — наступного разу ти перевикористаєш наявне замість одноразового bash.",
			].join("\n"),
			createdAt: new Date().toISOString(),
			tools: null,
		},
		{
			id: randomUUID(),
			name: "Coding",
			content: staticCodingPrompt(),
			createdAt: new Date().toISOString(),
			tools: null,
		},
		{
			id: randomUUID(),
			name: "Дослідження (analyze)",
			content: [
				"You are an investigation sub-agent working in a CLEAN, READ-ONLY context.",
				"",
				"Your job: investigate the goal stated in the user message using tools, then write a final summary.",
				"",
				"Available tools: read, bash, grep, find, ls, fetch. NO edit/write/analyze — do not attempt mutations.",
				"",
				"## Behavior",
				"- Investigate using read/grep/find/ls for files, bash for tests/builds/scripts, fetch for HTTP/API.",
				"- For HTTP/API, ALWAYS prefer 'fetch' over `bash curl`. fetch returns small structured output (max 4KB) and supports jq filtering. Do NOT write inline python3 to parse JSON.",
				"- Avoid heredocs and inline python in bash — they fail silently. Use simple pipes, or fetch + jq.",
				"- If a tool call fails or returns empty, DO NOT retry the same approach. Pivot to a different tool or write your final summary explaining what you tried.",
				"- After 2 failures with the same approach, STOP and write a summary of what you tried.",
				"",
				"## Output",
				"- When your investigation is complete (or you cannot make further progress), write a clear, concise final summary as plain text WITHOUT any tool calls.",
				"- The summary is returned to the orchestrator — it must contain everything needed to answer the goal: facts, decisions, file paths, code references.",
				"- No raw tool output. No preamble like 'I'll now investigate...'. Just the final summary.",
				"",
				"## Style",
				"- Be concise — minimal narration, maximal signal.",
				"- Act FIRST (call a tool), narrate LATER (only the summary).",
				"- Усі prose, коментарі, errors — українською (якщо не цитуєш код/логи).",
			].join("\n"),
			createdAt: new Date().toISOString(),
			tools: ["read","bash","grep","find","ls","fetch"],
		},
		{
			id: randomUUID(),
			name: "Mesh manager",
			content: [
				"# MESH · MANAGER",
				"",
				"Ти менеджер у mesh-мережі пі-агентів.",
				"",
				"## Твої обовʼязки",
				"1. Розділи задачу користувача на конкретні підзадачі.",
				"2. Делегуй кожну підзадачу через інструмент `chat` конкретному worker-у.",
				"3. Один `chat` = одна самодостатня підзадача. Worker НЕ бачить цю розмову —",
				"   включай У ПОВНОМУ обсязі потрібний контекст: шляхи файлів, вимоги, критерії приймання.",
				"4. Відповіді workers зʼявляються у твоїй розмові як `[worker-N reply]: ...` —",
				"   синтезуй їх для користувача стисло.",
				"5. Поточну активність workers (який tool виконують) ти бачиш автоматично —",
				"   окремо інформувати про неї не треба.",
				"",
				"## Що ти НЕ робиш",
				"- Не редагуєш файли сам.",
				"- Не пишеш код сам.",
				"- Не запускаєш bash сам (окрім read-only інспекції).",
				"- Всю істотну роботу виконують workers.",
			].join("\n"),
			createdAt: new Date().toISOString(),
			tools: ["read","grep","find","ls"],
		},
		{
			id: randomUUID(),
			name: "Mesh worker",
			content: [
				"# MESH · WORKER",
				"",
				"Ти worker у mesh-мережі пі-агентів.",
				"",
				"## Як приходять задачі",
				"- Задачі приходять як `user message` від менеджера (через mesh-канал).",
				"- Кожна задача самодостатня — не припускай контексту з попередніх задач.",
				"",
				"## Твої обовʼязки",
				"1. Прочитай задачу, виділи мету, контекст, критерії приймання.",
				"2. Виконуй задачу доступними інструментами (read/grep/find/bash/edit/write).",
				"3. По завершенні — виклич `reply` ОДИН раз з фінальним результатом.",
				"4. Не виходь за межі задачі. Якщо потрібен контекст, якого немає у повідомленні —",
				"   шукай його у файлах проєкту самостійно (read/grep/find).",
				"",
				"## Що НЕ робиш",
				"- Не пиши фінальну відповідь у чат — лише через інструмент `reply`.",
				"- Не роб припущень про наміри менеджера поза текстом задачі.",
				"- Не завершуй turn без `reply`.",
			].join("\n"),
			createdAt: new Date().toISOString(),
			tools: ["read","grep","find","ls"],
		},
	];
}

/**
 * Сховище шаблонів системних промптів: CRUD у prompts.json.
 */
export class PromptTemplateStore {
	private readonly path: string;

	constructor(path?: string) {
		this.path = path ?? join(getCoudyDir(), "prompts.json");
		ensureFile(this.path, JSON.stringify({ templates: [] }));
		this.seedDefaultsIfEmpty();
	}

	/** При першому запуску (store порожній) — засіяти готові шаблони з pi. */
	private seedDefaultsIfEmpty(): void {
		const data = readJson<PromptsFile>(this.path, { templates: [] });
		if (data.templates.length > 0) return;
		writeJson(this.path, { templates: getDefaultTemplates() });
	}

	/**
	 * Додати відсутні дефолтні pi-шаблони (за name). НЕ затирає існуючі
	 * (навіть відредаговані дефолти лишає як є). Повертає оновлений список.
	 */
	addMissingDefaults(): { added: number; templates: PromptTemplate[] } {
		const data = readJson<PromptsFile>(this.path, { templates: [] });
		const existing = new Set(data.templates.map((t) => t.name));
		let added = 0;
		for (const def of getDefaultTemplates()) {
			if (existing.has(def.name)) continue;
			data.templates.push({ ...def, id: randomUUID(), createdAt: new Date().toISOString() });
			added++;
		}
		if (added > 0) writeJson(this.path, data);
		return { added, templates: this.list() };
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
	create(name: string, content: string, tools?: string[] | null): PromptTemplate {
		const trimmedName = name.trim();
		if (!trimmedName) throw new Error("Потрібне поле name");
		const data = readJson<PromptsFile>(this.path, { templates: [] });
		const template: PromptTemplate = {
			id: randomUUID(),
			name: trimmedName,
			content,
			createdAt: new Date().toISOString(),
			...(tools === undefined ? {} : { tools }),
		};
		data.templates.push(template);
		writeJson(this.path, data);
		return template;
	}

	/** Оновити name/content/tools шаблону. null якщо id не знайдено. */
	update(id: string, patch: { name?: string; content?: string; tools?: string[] | null }): PromptTemplate | null {
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
		// tools: null = усі; [] = без; [...] = лише ці. undefined → не чіпати.
		if (patch.tools !== undefined) {
			data.templates[idx]!.tools = Array.isArray(patch.tools) ? patch.tools : null;
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
