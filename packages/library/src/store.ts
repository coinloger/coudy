/**
 * Глобальний store бібліотеки функцій: персистентне сховище + CRUD + пошук + виконання.
 *
 * Сховище: ~/.coudycode/library/
 *   ├── index.json               — маніфест (entries + embeddings, 0o600)
 *   └── <category>/<name>.ts     — ESM-модулі функцій (0o600)
 *
 * Кожна функція = окремий .ts-модуль з `meta` + `run(params, ctx)`.
 * Embedding опису рахується при create/modify, зберігається в маніфесті.
 * Пошук: semantic (cosine top-K) + keyword fallback (substring).
 * Виконання: in-process (esbuild-трансформ .ts → dynamic import → run).
 * Hot-reload модуля по mtime (кеш скомпільованих модулів).
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve as pathResolve } from "node:path";
import { homedir } from "node:os";
import { transform as esbuildTransform } from "esbuild";
import { embed, cosine } from "./embeddings.ts";
import type {
	FunctionModule,
	LibraryCtx,
	LibraryEntry,
	ParamsSpec,
	SearchResult,
} from "./types.ts";
import { LibraryError } from "./types.ts";

const WRITE_OPTIONS = { encoding: "utf-8", mode: 0o600 } as const;
const MANIFEST_REL = "index.json";

/** Опції конструктора LibraryStore. */
export interface LibraryStoreOptions {
	/** Кореневий каталог бібліотеки (default: ~/.coudycode/library). */
	rootDir?: string;
}

/**
 * Глобальне сховище бібліотеки функцій.
 * Один екземпляр на процес (singleton у server; але клас stateless щодо цього).
 */
export class LibraryStore {
	private readonly rootDir: string;
	private readonly manifestPath: string;
	/** Кеш скомпільованих .ts-модулів (по mtime) → module URL. */
	private moduleCache = new Map<string, { mtime: number; url: string }>();
	/** Кеш завантажених модулів за name (для композиції). */
	private loadedModules = new Map<string, FunctionModule>();

	constructor(opts: LibraryStoreOptions = {}) {
		this.rootDir = opts.rootDir ?? join(homedir(), ".coudycode", "library");
		this.manifestPath = join(this.rootDir, MANIFEST_REL);
		this.ensureRoot();
		this.ensureManifest();
	}

	/** Базова директорія coudycode (env COUDYCODE_DIR || ~/.coudycode). */
	static coudyDir(): string {
		const fromEnv = process.env["COUDYCODE_DIR"];
		if (fromEnv && fromEnv.trim().length > 0) return fromEnv;
		return join(homedir(), ".coudycode");
	}

	/** Створити кореневу папку (0o700) якщо відсутня. */
	private ensureRoot(): void {
		if (!existsSync(this.rootDir)) {
			mkdirSync(this.rootDir, { recursive: true, mode: 0o700 });
		}
	}

	/** Створити маніфест (0o600) якщо відсутній. */
	private ensureManifest(): void {
		if (!existsSync(this.manifestPath)) {
			writeFileSync(this.manifestPath, JSON.stringify({ entries: [] }, null, 2), WRITE_OPTIONS);
			this.chmod(this.manifestPath);
		}
	}

	private chmod(filePath: string): void {
		try {
			chmodSync(filePath, 0o600);
		} catch {
			/* chmod може не спрацювати на деяких ФС — ігноруємо */
		}
	}

	private readManifest(): LibraryEntry[] {
		try {
			const raw = readFileSync(this.manifestPath, "utf-8").trim();
			if (!raw) return [];
			const parsed = JSON.parse(raw) as { entries?: LibraryEntry[] };
			return Array.isArray(parsed.entries) ? parsed.entries : [];
		} catch {
			return [];
		}
	}

	private writeManifest(entries: LibraryEntry[]): void {
		writeFileSync(this.manifestPath, JSON.stringify({ entries }, null, 2), WRITE_OPTIONS);
		this.chmod(this.manifestPath);
	}

	/** slug із name: нижній регістр, заміна пробілів/недопустимих символів на _. */
	private toId(name: string): string {
		return name
			.trim()
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "_")
			.replace(/^_+|_+$/g, "");
	}

	/** Відносний шлях до .ts-модуля функції. */
	private moduleRel(entry: LibraryEntry): string {
		return entry.file;
	}

	/** Абсолютний шлях до .ts-модуля функції. */
	private moduleAbs(entry: LibraryEntry): string {
		return pathResolve(this.rootDir, entry.file);
	}

	/**
	 * Побудувати контекст виконання функції (core-примітиви + композиція).
	 * `deps` підключає ProcessRegistry/sh (від сервера) — не тягнемо import в пакет.
	 */
	buildCtx(deps: {
		cwd: string;
		procList: () => unknown[];
		procKill: (pid: number) => boolean;
	}): LibraryCtx {
		const store = this;
		const dbDir = join(this.rootDir, "db");
		if (!existsSync(dbDir)) mkdirSync(dbDir, { recursive: true, mode: 0o700 });
		const dbPath = join(dbDir, "library.db");

		return {
			cwd: deps.cwd,
			fs: {
				async read(path: string): Promise<string> {
					return readFileSync(pathResolve(deps.cwd, path), "utf-8");
				},
				async write(path: string, content: string): Promise<void> {
					const abs = pathResolve(deps.cwd, path);
					mkdirSync(dirname(abs), { recursive: true });
					writeFileSync(abs, content, "utf-8");
				},
				async readJson<T = unknown>(path: string): Promise<T> {
					return JSON.parse(readFileSync(pathResolve(deps.cwd, path), "utf-8")) as T;
				},
				async writeJson(path: string, data: unknown): Promise<void> {
					const abs = pathResolve(deps.cwd, path);
					mkdirSync(dirname(abs), { recursive: true });
					writeFileSync(abs, JSON.stringify(data, null, 2), "utf-8");
				},
				async exists(path: string): Promise<boolean> {
					return existsSync(pathResolve(deps.cwd, path));
				},
			},
			async sh(command: string, opts?: { cwd?: string }): Promise<{ stdout: string; stderr: string; code: number }> {
				const { execFileSync } = await import("node:child_process");
				const shCwd = opts?.cwd ? pathResolve(deps.cwd, opts.cwd) : deps.cwd;
				try {
					const stdout = execFileSync(command, {
						shell: true,
						cwd: shCwd,
						encoding: "utf-8",
						maxBuffer: 10 * 1024 * 1024,
					});
					return { stdout, stderr: "", code: 0 };
				} catch (e) {
					const err = e as { stdout?: string; stderr?: string; status?: number };
					return {
						stdout: err.stdout ?? "",
						stderr: err.stderr ?? String(e),
						code: typeof err.status === "number" ? err.status : 1,
					};
				}
			},
			proc: {
				list(): unknown[] {
					return deps.procList();
				},
				kill(pid: number): boolean {
					return deps.procKill(pid);
				},
			},
			db: dbPath,
			path: {
				join(...parts: string[]): string {
					return join(...parts);
				},
				resolve(p: string): string {
					return pathResolve(deps.cwd, p);
				},
			},
			async call(
				name: string,
				params: Record<string, unknown>,
				opts?: { scope?: "session" | "global" | "auto" },
			): Promise<unknown> {
				return store.resolveCall(name, params, deps, opts);
			},
		};
	}

	/** Усі записи маніфесту (без коду). */
	list(category?: string): LibraryEntry[] {
		const all = this.readManifest();
		if (!category) return all;
		return all.filter((e) => e.category === category);
	}

	/** Один запис за name (або null). */
	get(name: string): LibraryEntry | null {
		const id = this.toId(name);
		return this.readManifest().find((e) => e.id === id) ?? null;
	}

	/** Код .ts-модуля функції (для UI/API). */
	readCode(name: string): string | null {
		const entry = this.get(name);
		if (!entry) return null;
		try {
			return readFileSync(this.moduleAbs(entry), "utf-8");
		} catch {
			return null;
		}
	}

	/**
	 * Створити нову функцію. Валідація: name непорожній, дубль name → 409 (LibraryError).
	 * Розраховує embedding опису → зберігає в маніфесті.
	 */
	async create(input: {
		name: string;
		description: string;
		params?: ParamsSpec;
		code: string;
		category?: string;
		tags?: string[];
	}): Promise<LibraryEntry> {
		const name = input.name.trim();
		if (!name) throw new LibraryError("Потрібне поле name");
		const id = this.toId(name);
		const entries = this.readManifest();
		if (entries.some((e) => e.id === id)) {
			throw new LibraryError(`Функція "${name}" вже існує`);
		}

		const category = input.category?.trim() || undefined;
		const file = `${category ? `${category}/` : ""}${id}.ts`;
		const filePath = join(this.rootDir, file);
		mkdirSync(dirname(filePath), { recursive: true, mode: 0o700 });
		writeFileSync(filePath, input.code, WRITE_OPTIONS);
		this.chmod(filePath);

		const now = Date.now();
		const entry: LibraryEntry = {
			id,
			name,
			category,
			description: input.description,
			params: input.params,
			tags: input.tags ?? [],
			file,
			createdAt: now,
			updatedAt: now,
		};
		entry.embedding = await this.computeEmbedding(entry);
		entries.push(entry);
		this.writeManifest(entries);
		return entry;
	}

	/**
	 * Оновити існуючу функцію (code/description/params/category/tags).
	 * Перераховує embedding якщо змінився description/tags.
	 */
	async update(
		name: string,
		patch: {
			description?: string;
			params?: ParamsSpec;
			code?: string;
			category?: string;
			tags?: string[];
		},
	): Promise<LibraryEntry | null> {
		const id = this.toId(name);
		const entries = this.readManifest();
		const idx = entries.findIndex((e) => e.id === id);
		if (idx === -1) return null;
		const entry = entries[idx]!;
		const oldSig = `${entry.description}|${entry.tags.join(",")}`;

		let newCategory = entry.category;
		if (typeof patch.category === "string") {
			newCategory = patch.category.trim() || undefined;
		}
		if (typeof patch.description === "string") entry.description = patch.description;
		if (patch.params !== undefined) entry.params = patch.params;
		if (Array.isArray(patch.tags)) entry.tags = patch.tags;
		entry.updatedAt = Date.now();

		// Перенести файл якщо змінилась категорія.
		const newFile = `${newCategory ? `${newCategory}/` : ""}${id}.ts`;
		if (newFile !== entry.file) {
			const oldAbs = this.moduleAbs(entry);
			entry.category = newCategory;
			entry.file = newFile;
			const newAbs = join(this.rootDir, newFile);
			mkdirSync(dirname(newAbs), { recursive: true, mode: 0o700 });
			writeFileSync(newAbs, readFileSync(oldAbs, "utf-8"), WRITE_OPTIONS);
			this.chmod(newAbs);
			try {
				// старий файл прибрати (не кидатись якщо не існує).
				import("node:fs").then((fs) => fs.promises.unlink(oldAbs).catch(() => undefined));
			} catch {
				/* ignore */
			}
		} else {
			entry.category = newCategory;
		}

		// Записати новий код.
		if (typeof patch.code === "string") {
			writeFileSync(this.moduleAbs(entry), patch.code, WRITE_OPTIONS);
			this.chmod(this.moduleAbs(entry));
			// Скинути кеш модуля (код змінився).
			this.moduleCache.delete(this.moduleAbs(entry));
			this.loadedModules.delete(id);
		}

		// Перерахувати embedding якщо опис/tags змінились.
		const newSig = `${entry.description}|${entry.tags.join(",")}`;
		if (newSig !== oldSig) {
			entry.embedding = await this.computeEmbedding(entry);
		}

		entries[idx] = entry;
		this.writeManifest(entries);
		return entry;
	}

	/** Видалити функцію (модуль + запис маніфесту). */
	delete(name: string): boolean {
		const id = this.toId(name);
		const entries = this.readManifest();
		const idx = entries.findIndex((e) => e.id === id);
		if (idx === -1) return false;
		const entry = entries[idx]!;
		try {
			const fs = require("node:fs");
			fs.unlinkSync(this.moduleAbs(entry));
		} catch {
			/* файл міг вже не існувати */
		}
		entries.splice(idx, 1);
		this.writeManifest(entries);
		this.moduleCache.delete(this.moduleAbs(entry));
		this.loadedModules.delete(id);
		return true;
	}

	/**
	 * Розрахувати embedding для запису (description + tags + name).
	 * Текст для індексування обʼєднує всі семантичні сигнали.
	 */
	private async computeEmbedding(entry: LibraryEntry): Promise<number[]> {
		const text = [entry.name, entry.category, entry.description, ...(entry.tags ?? [])]
			.filter(Boolean)
			.join(" | ");
		return embed(text);
	}

	/**
	 * Семантичний пошук: embeddings (cosine top-K) + keyword fallback.
	 * Пошук за embedding запросу (рахується в runtime) проти embeddings маніфесту.
	 * Keyword-збіги (substring по name/tags/description) гарантовано включаються.
	 */
	async search(query: string, topK = 6): Promise<SearchResult[]> {
		const entries = this.readManifest();
		if (entries.length === 0) return [];
		const q = query.trim().toLowerCase();
		if (!q) return [];

		const scored: SearchResult[] = [];
		const seen = new Set<string>();

		// 1. Keyword fallback: substring по name/tags/description.
		for (const e of entries) {
			const hay = `${e.name} ${e.tags.join(" ")} ${e.description}`.toLowerCase();
			if (hay.includes(q)) {
				scored.push({
					name: e.name,
					description: e.description,
					category: e.category,
					params: e.params,
					tags: e.tags,
					score: 1,
				});
				seen.add(e.id);
			}
		}

		// 2. Semantic: cosine(query_embedding, entry.embedding) top-K.
		const withEmb = entries.filter((e) => e.embedding && e.embedding.length > 0);
		if (withEmb.length > 0) {
			const qEmb = await embed(query);
			const sem = withEmb
				.map((e) => ({ entry: e, score: cosine(qEmb, e.embedding!) }))
				.filter((x) => x.score > 0.15);
			sem.sort((a, b) => b.score - a.score);
			for (const { entry, score } of sem.slice(0, topK)) {
				if (seen.has(entry.id)) continue;
				scored.push({
					name: entry.name,
					description: entry.description,
					category: entry.category,
					params: entry.params,
					tags: entry.tags,
					score: Number(score.toFixed(4)),
				});
				seen.add(entry.id);
			}
		}

		// Сортувати: keyword (score=1) вище, далі semantic за спаданням score.
		scored.sort((a, b) => b.score - a.score);
		return scored.slice(0, topK);
	}

	/**
	 * Резолвити ctx.call: базово — лише власний store (global).
	 * SessionScriptStore перевизначає для session→global пошуку.
	 */
	protected resolveCall(
		name: string,
		params: Record<string, unknown>,
		deps: { cwd: string; procList: () => unknown[]; procKill: (pid: number) => boolean },
		_opts?: { scope?: "session" | "global" | "auto" },
	): Promise<unknown> {
		return this.run(name, params, deps);
	}

	/**
	 * Виконати функцію in-process: esbuild-трансформ .ts → dynamic import → run.
	 * Hot-reload по mtime (кеш скидається при зміні файлу).
	 */
	async run(
		name: string,
		params: Record<string, unknown>,
		deps: { cwd: string; procList: () => unknown[]; procKill: (pid: number) => boolean },
	): Promise<unknown> {
		const entry = this.get(name);
		if (!entry) throw new LibraryError(`Функцію "${name}" не знайдено`);
		const mod = await this.loadModule(entry);
		const ctx = this.buildCtx(deps);
		return mod.run(params, ctx);
	}

	/**
	 * Завантажити .ts-модуль функції (з hot-reload по mtime).
	 * esbuild трансформує TS → JS у памʼяті, завантажуємо через data: URL.
	 */
	private async loadModule(entry: LibraryEntry): Promise<FunctionModule> {
		const abs = this.moduleAbs(entry);
		const stat = await import("node:fs").then((fs) => fs.promises.stat(abs));
		const mtime = stat.mtimeMs;

		// Повернути кешований модуль якщо mtime не змінився.
		const cached = this.loadedModules.get(entry.id);
		if (cached && this.moduleCache.has(abs) && this.moduleCache.get(abs)!.mtime === mtime) {
			return cached;
		}

		const source = readFileSync(abs, "utf-8");
		const result = await esbuildTransform(source, {
			loader: "ts",
			target: "es2022",
			format: "esm",
			sourcefile: abs,
		});

		// Завантажити через data: URL (in-memory, без temp-файлів).
		const url = "data:text/javascript;base64," + Buffer.from(result.code).toString("base64");
		const mod = (await import(url)) as FunctionModule;
		if (!mod.meta || typeof mod.run !== "function") {
			throw new LibraryError(`Модуль "${entry.name}" має експортувати meta + run`);
		}
		this.moduleCache.set(abs, { mtime, url });
		this.loadedModules.set(entry.id, mod);
		return mod;
	}
}

/**
 * Сесійний store скриптів: задачоспецифічні «чорновики», scoped до sessionId.
 *
 * Сховище: ~/.coudycode/session-scripts/<sessionId>/ (index.json + .ts модулі, 0o600).
 * Формат модуля ідентичний глобальному (meta + run). БЕЗ примусового search-flow.
 *
 * Композиція через ctx.call резолвить session→global (більш специфічне виграє):
 * session-скрипт може кликати й інші сесійні, й глобальні.
 */
export class SessionScriptStore extends LibraryStore {
	private readonly sessionId: string;
	private readonly globalStore?: LibraryStore;

	/**
	 * @param sessionId  ідентифікатор сесії (директорія-сфера).
	 * @param globalStore опц. посилання на глобальний store (для ctx.call session→global).
	 * @param opts.rootDir опц. корінь (default: <coudy>/session-scripts/<sessionId>).
	 */
	constructor(sessionId: string, globalStore?: LibraryStore, opts?: { rootDir?: string }) {
		const rootDir = opts?.rootDir ?? join(LibraryStore.coudyDir(), "session-scripts", sessionId);
		super({ rootDir });
		this.sessionId = sessionId;
		this.globalStore = globalStore;
	}

	/** sessionId цього store. */
	getScopeId(): string {
		return this.sessionId;
	}

	/**
	 * Композиція session→global: session-сценарій спершу, потім global.
	 * opts.scope дозволяє обрати рівень явно ("session"/"global"/"auto").
	 */
	protected async resolveCall(
		name: string,
		params: Record<string, unknown>,
		deps: { cwd: string; procList: () => unknown[]; procKill: (pid: number) => boolean },
		opts?: { scope?: "session" | "global" | "auto" },
	): Promise<unknown> {
		const scope = opts?.scope ?? "auto";

		// Лише сесійний рівень.
		if (scope === "session") {
			if (!this.get(name)) throw new LibraryError(`Сесійний скрипт "${name}" не знайдено`);
			return this.run(name, params, deps);
		}
		// Лише глобальний рівень.
		if (scope === "global") {
			if (!this.globalStore) throw new LibraryError("Глобальний store не налаштований");
			if (!this.globalStore.get(name)) throw new LibraryError(`Глобальну функцію "${name}" не знайдено`);
			return this.globalStore.run(name, params, deps);
		}
		// auto: спершу session, потім global (більш специфічне виграє).
		if (this.get(name)) return this.run(name, params, deps);
		if (this.globalStore?.get(name)) return this.globalStore.run(name, params, deps);
		throw new LibraryError(`"${name}" не знайдено ні в session, ні в global`);
	}
}
