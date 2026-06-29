/**
 * Типи глобальної бібліотеки функцій (skill library).
 *
 * Кожна функція = окремий ESM-модуль у ~/.coudycode/library/<category>/<name>.ts
 * з `meta` + `run(params, ctx)`. Маніфест index.json тримає метадані + embeddings.
 */

/** Тип параметра функції бібліотеки. */
export type ParamType = "string" | "number" | "boolean";

/** Опис одного параметра функції. */
export interface ParamSpec {
	type: ParamType;
	required?: boolean;
	desc?: string;
}

/** Карта параметрів функції: paramName → специфікація. */
export type ParamsSpec = Record<string, ParamSpec>;

/**
 * Метадані функції бібліотеки (експорт `meta` з модуля).
 * Дублюються в маніфесті index.json (для пошуку без завантаження модуля).
 */
export interface FunctionMeta {
	name: string;
	category?: string;
	description: string;
	params?: ParamsSpec;
	tags?: string[];
}

/** Контракт ESM-модуля функції бібліотеки. */
export interface FunctionModule {
	meta: FunctionMeta;
	run(params: Record<string, unknown>, ctx: LibraryCtx): Promise<unknown> | unknown;
}

/**
 * Контекст виконання функції: core-примітиви + композиція.
 * Дає функціям доступ до fs/shell/processes/db/path + виклик інших методів бібліотеки.
 */
export interface LibraryCtx {
	/** Робоча директорія (cwd запущеного сервера). */
	cwd: string;
	/** Файлові примітиви: read/write файлів. */
	fs: {
		read(path: string): Promise<string>;
		write(path: string, content: string): Promise<void>;
		readJson<T = unknown>(path: string): Promise<T>;
		writeJson(path: string, data: unknown): Promise<void>;
		exists(path: string): Promise<boolean>;
	};
	/** Shell-out: виконати команду (синхронно чекає завершення). */
	sh(command: string, opts?: { cwd?: string }): Promise<{ stdout: string; stderr: string; code: number }>;
	/** Керування процесами (інтеграція ProcessRegistry). */
	proc: {
		list(): unknown[];
		kill(pid: number): boolean;
	};
	/** Шлях до db (sqlite3 через shell) — папка ~/.coudycode/library/db/. */
	readonly db: string;
	/** Робота зі шляхами. */
	path: {
		join(...parts: string[]): string;
		resolve(p: string): string;
	};
	/**
	 * КОМПОЗИЦІЯ: викликати інший метод бібліотеки за імʼям з params.
	 * Дозволяє функціям перевикористовувати одна одну.
	 */
	call(name: string, params: Record<string, unknown>): Promise<unknown>;
}

/** Запис маніфесту index.json (без коду). */
export interface LibraryEntry {
	/** Стабільний id (name-based slug). */
	id: string;
	name: string;
	category?: string;
	description: string;
	params?: ParamsSpec;
	tags: string[];
	/** Шлях до .ts-модуля відносно library root. */
	file: string;
	createdAt: number;
	updatedAt: number;
	/** Embedding-вектор опису (384-dim для all-MiniLM-L6-v2). */
	embedding?: number[];
}

/** Результат пошуку. */
export interface SearchResult {
	name: string;
	description: string;
	category?: string;
	params?: ParamsSpec;
	tags: string[];
	/** Оцінка релевантності (0..1 для semantic, 1 для keyword-збігу). */
	score: number;
}

/** Формат файлу маніфесту index.json. */
export interface LibraryManifestFile {
	entries: LibraryEntry[];
}

/** Помилка бібліотеки (напр. дубль name, функція не знайдена). */
export class LibraryError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "LibraryError";
	}
}
