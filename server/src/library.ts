/**
 * Бібліотека функцій: API-тулзи для агента (library_search/call/create/modify/list)
 * + примусовий search-flow + HTTP-хендлери.
 *
 * ПРИМУСОВИЙ FLOW (system-level, не совісті агента):
 *   - searchedThisTurn: Set<sessionId> — скидати на початку кожного ходу.
 *   - library_search → встановлює searchedThisTurn=true.
 *   - library_create/modify → відхиляє (помилка) якщо searchedThisTurn=false.
 *   - library_call → без обмежень (виклик не вимагає search).
 *
 * Тулзи реєструються через хук tools:register (як плагін-тулзи) — ДЕФОЛТНО ВКЛЮЧЕНІ.
 * Категорія в global-тулзах, тож фільтр шаблону бачить їх.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { Type, type Static } from "typebox";
import type { AgentTool } from "@coudycode/agent-core";
import { wrapToolDefinition } from "@coudycode/tools";
import type { ToolDefinition } from "@coudycode/tools";
import { LibraryStore, SessionScriptStore } from "@coudycode/library";
import { processRegistry } from "./processes.js";

/** Глобальний singleton store бібліотеки (один на сервер). */
export const libraryStore = new LibraryStore({ rootDir: LibraryStore.coudyDir() });

/**
 * Кеш сесійних store-ів: один SessionScriptStore на сесію (теплі кеші модулів).
 * SessionScriptStore підключений до глобального store для композиції session→global.
 */
const sessionStores = new Map<string, SessionScriptStore>();

/** Отримати (створити за потреби) сесійний store для sessionId. */
export function getSessionScriptStore(sessionId: string): SessionScriptStore {
	let s = sessionStores.get(sessionId);
	if (!s) {
		s = new SessionScriptStore(sessionId, libraryStore);
		sessionStores.set(sessionId, s);
	}
	return s;
}

/**
 * Стан примусового search-flow: per-session флаг «був search у цьому ході».
 * Скидається на початку кожного ходу (handleChat викликає resetTurn).
 */
class SearchFlowState {
	private searched = new Set<string>();

	/** Позначити, що сесія зробила search у цьому ході. */
	markSearched(sessionId: string): void {
		this.searched.add(sessionId);
	}

	/** Чи був search у цьому ході для сесії. */
	hasSearched(sessionId: string): boolean {
		return this.searched.has(sessionId);
	}

	/** Скинути флаг сесії (на початку нового ходу). */
	resetTurn(sessionId: string): void {
		this.searched.delete(sessionId);
	}
}

const searchFlow = new SearchFlowState();

/** Експорт для handleChat: скидати search-flow на початку кожного ходу. */
export function resetLibraryTurn(sessionId: string): void {
	searchFlow.resetTurn(sessionId);
}

/** Залежності для виконання функцій бібліотеки (ProcessRegistry integration). */
function libDeps(cwd: string) {
	return {
		cwd,
		procList: () => processRegistry.list(),
		procKill: (pid: number) => processRegistry.kill(pid),
	};
}

// ===== Schemas для тулзів =====

/**
 * Опис параметра `code` для library_create/modify та session-аналогів.
 * Містить ПОВНИЙ контракт ctx + робочий приклад — щоб модель не вигадувала API
 * (напр. ctx.sh.exec замість ctx.sh). Джерело правди: packages/library/src/types.ts (LibraryCtx).
 */
const CODE_PARAM_DESCRIPTION = [
	"Код ESM-модуля (TypeScript). Структура обовʼязкова:",
	'  export const meta = { name: "...", description: "...", params: { field: { type: "string", desc: "..." } } };',
	"  export async function run(params: Record<string, any>, ctx: any) { ... return результат; }",
	"",
	"ctx — контекст з примітивами (ВСІ async, await обовʼязковий):",
	"  ctx.cwd: string",
	"  ctx.fs.read(path): Promise<string>       ctx.fs.write(path, content): Promise<void>",
	"  ctx.fs.readJson(path): Promise<any>      ctx.fs.writeJson(path, data): Promise<void>",
	"  ctx.fs.exists(path): Promise<boolean>",
	"  ctx.sh(command, opts?): Promise<{stdout,stderr,code}>   ← ФУНКЦІЯ, не ctx.sh.exec!",
	"  ctx.proc.list(): unknown[]               ctx.proc.kill(pid): boolean",
	"  ctx.db: string (шлях до папки з .db файлами)",
	"  ctx.path.join(...parts): string          ctx.path.resolve(p): string",
	'  ctx.call(name, params, { scope?: "global"|"session" }): Promise<unknown>  ← КОМПОЗИЦІЯ інших функцій',
	"",
	"РОБОЧИЙ ПРИКЛАД (скопіюй патерн):",
	'  export const meta = { name: "sqlite_query", description: "Виконує SQL через sqlite3", params: { sql: { type: "string", desc: "SQL запит" } } };',
	'  export async function run(params: { sql: string }, ctx: any) {',
	'    const dbPath = ctx.path.join(ctx.db, "data.db");',
	'    const r = await ctx.sh(`sqlite3 -json "${dbPath}" "${params.sql.replace(/"/g, "\\\"")}"`);',
	"    if (r.code !== 0) throw new Error(r.stderr);",
	'    return JSON.parse(r.stdout || "[]");',
	"  }",
	"",
	"ЗАБОРОНЕНО: external imports (deno.land, npm) — лише node:* вбудовані. ctx.fs/sh/proc/path/call НЕ імпортуються, вони приходять 2-м аргументом run().",
].join("\n");

/**
 * Якщо runtime-помилка вказує на вигаданий API контексту (ctx.sh.exec та ін.) —
 * додати підказку з правильним контрактом, щоб модель сама себе поправила.
 */
function hintRuntimeError(err: unknown): string {
	const msg = err instanceof Error ? err.message : String(err);
	if (/\.exec is not a function|ctx\.sh\b.*is not a function|ctx\.\w+\.\w+ is not a function/i.test(msg)) {
		return `${msg}\n(підказка: ctx.sh — ФУНКЦІЯ, викликай \`await ctx.sh(\"cmd\")\` → {stdout,stderr,code}; НЕ ctx.sh.exec. ctx.fs/proc/path/call теж через await.)`;
	}
	return msg;
}

const searchSchema = Type.Object({
	query: Type.String({ description: "Опис задачі/функциональності для пошуку в бібліотеці. Семантичний пошук за описом+тегами." }),
});
const callSchema = Type.Object({
	name: Type.String({ description: "Імʼя функції бібліотеки для виклику." }),
	params: Type.Record(Type.String(), Type.Unknown(), {
		description: "Параметри функції (обʼєкт ключ→значення відповідно до контракту функції).",
	}),
});
const createSchema = Type.Object({
	name: Type.String({ description: "Унікальне імʼя функції (slug: латиниця, цифри, _). Загальне, не привʼязане до конкретної задачі." }),
	description: Type.String({ description: "Опис що робить функція (для семантичного пошуку). Будь конкретним." }),
	params: Type.Record(Type.String(), Type.Object({
		type: Type.Union([Type.Literal("string"), Type.Literal("number"), Type.Literal("boolean")]),
		required: Type.Optional(Type.Boolean()),
		desc: Type.Optional(Type.String()),
	}), { description: "Контракт параметрів: імʼя → {type, required, desc}. Загальні параметри, без хардкоду." }),
	code: Type.String({ description: CODE_PARAM_DESCRIPTION }),
	category: Type.Optional(Type.String({ description: "Категорія (опц.): markets, git, fs, ..." })),
	tags: Type.Optional(Type.Array(Type.String(), { description: "Теги для пошуку (опц.)." })),
});
const modifySchema = Type.Object({
	name: Type.String({ description: "Імʼя функції для оновлення." }),
	description: Type.Optional(Type.String()),
	params: Type.Optional(Type.Record(Type.String(), Type.Object({
		type: Type.Union([Type.Literal("string"), Type.Literal("number"), Type.Literal("boolean")]),
		required: Type.Optional(Type.Boolean()),
		desc: Type.Optional(Type.String()),
	}))),
	code: Type.Optional(Type.String({ description: CODE_PARAM_DESCRIPTION })),
	category: Type.Optional(Type.String()),
	tags: Type.Optional(Type.Array(Type.String())),
});
const listSchema = Type.Object({
	category: Type.Optional(Type.String({ description: "Фільтр за категорією (опц.)." })),
});

// ===== Schemas для сесійних скриптів =====

const sessionCreateSchema = Type.Object({
	name: Type.String({ description: "Унікальне імʼя сесійного скрипта всередині сесії." }),
	description: Type.String({ description: "Опис що робить скрипт." }),
	params: Type.Optional(Type.Record(Type.String(), Type.Object({
		type: Type.Union([Type.Literal("string"), Type.Literal("number"), Type.Literal("boolean")]),
		required: Type.Optional(Type.Boolean()),
		desc: Type.Optional(Type.String()),
	}), { description: "Контракт параметрів (опц.)." })),
	code: Type.String({ description: CODE_PARAM_DESCRIPTION }),
	tags: Type.Optional(Type.Array(Type.String())),
});
const sessionCallSchema = Type.Object({
	name: Type.String({ description: "Імʼя сесійного скрипта для виклику." }),
	params: Type.Record(Type.String(), Type.Unknown(), { description: "Параметри скрипта (обʼєкт ключ→значення)." }),
});
const sessionModifySchema = Type.Object({
	name: Type.String({ description: "Імʼя сесійного скрипта для оновлення." }),
	description: Type.Optional(Type.String()),
	params: Type.Optional(Type.Record(Type.String(), Type.Object({
		type: Type.Union([Type.Literal("string"), Type.Literal("number"), Type.Literal("boolean")]),
		required: Type.Optional(Type.Boolean()),
		desc: Type.Optional(Type.String()),
	}))),
	code: Type.Optional(Type.String({ description: CODE_PARAM_DESCRIPTION })),
	tags: Type.Optional(Type.Array(Type.String())),
});
const sessionListSchema = Type.Object({});
const promoteSchema = Type.Object({
	name: Type.String({ description: "Імʼя сесійного скрипта для публікації в глобальну бібліотеку." }),
	category: Type.Optional(Type.String({ description: "Категорія в глобалі (опц.)." })),
});

/**
 * Побудувати тулзи бібліотеки для конкретної сесії (session-aware search-flow).
 * Повертає 5 AgentToolʼів: library_search/call/create/modify/list.
 */
export function createLibraryTools(sessionId: string, cwd: string): AgentTool[] {
	const deps = libDeps(cwd);

	const defs: ToolDefinition[] = [
		{
			name: "library_search",
			label: "library_search",
			description:
				"Пошук у глобальній бібліотеці функцій. ОБОВʼЯЗКОВИЙ перед створенням нової функції — перевикористовуй наявне. " +
				"Повертає top-K релевантних функцій з описами + параметрами. Семантичний (embeddings) + keyword.",
			promptSnippet: "Search the function library (required before create)",
			parameters: searchSchema,
			async execute(_id, params: Static<typeof searchSchema>) {
				const results = await libraryStore.search(params.query);
				searchFlow.markSearched(sessionId);
				if (results.length === 0) {
					return {
						content: [{ type: "text", text: "Нічого не знайдено. Можеш створити нову функцію через library_create." }],
						details: { results: [], searched: true },
					};
				}
				const lines = results.map(
					(r, i) =>
						`${i + 1}. ${r.name} [${r.category ?? "uncat"}] (score=${r.score}): ${r.description}` +
						(r.params ? `\n   params: ${JSON.stringify(r.params)}` : ""),
				);
				return {
					content: [{ type: "text", text: `Знайдено функцій: ${results.length}\n${lines.join("\n")}\n\nВиклич через library_call(name, params).` }],
					details: { results, searched: true },
				};
			},
		},
		{
			name: "library_call",
			label: "library_call",
			description:
				"Виконати наявну функцію бібліотеки за імʼям з params. Повертає результат. Без обмежень.",
			promptSnippet: "Call an existing library function",
			parameters: callSchema,
			async execute(_id, params: Static<typeof callSchema>) {
				let result: unknown;
				try {
					result = await libraryStore.run(params.name, params.params, deps);
				} catch (err) {
					throw new Error(hintRuntimeError(err));
				}
				const text = typeof result === "string" ? result : JSON.stringify(result, null, 2);
				return { content: [{ type: "text", text }], details: { result } };
			},
		},
		{
			name: "library_create",
			label: "library_create",
			description:
				"Створити нову ЗАГАЛЬНУ параметризовану функцію в бібліотеці (без хардкоду конкретних значень). " +
				"ВИМАГАЄ попереднього library_search у цьому ході (інакше відхиляється). Методи компонуються через ctx.call.",
			promptSnippet: "Create a new reusable library function",
			parameters: createSchema,
			async execute(_id, params: Static<typeof createSchema>) {
				if (!searchFlow.hasSearched(sessionId)) {
					return {
						content: [{
							type: "text",
							text: "Спершу виконай library_search — можливо функція вже існує. Створення нової можливе лише після пошуку.",
						}],
						details: { created: false, reason: "no_search" },
					};
				}
				const entry = await libraryStore.create({
					name: params.name,
					description: params.description,
					params: params.params,
					code: params.code,
					category: params.category,
					tags: params.tags,
				});
				// create споживає search-token: наступне create знову вимагає search.
				searchFlow.resetTurn(sessionId);
				return {
					content: [{ type: "text", text: `Створено функцію "${entry.name}" [${entry.category ?? "uncat"}]. Тепер доступна через library_call.` }],
					details: { created: true, entry: { ...entry, embedding: undefined } },
				};
			},
		},
		{
			name: "library_modify",
			label: "library_modify",
			description:
				"Оновити існуючу функцію (code/description/params/category/tags). ВИМАГАЄ library_search у цьому ході.",
			promptSnippet: "Modify an existing library function",
			parameters: modifySchema,
			async execute(_id, params: Static<typeof modifySchema>) {
				if (!searchFlow.hasSearched(sessionId)) {
					return {
						content: [{
							type: "text",
							text: "Спершу виконай library_search перед модифікацією функції.",
						}],
						details: { modified: false, reason: "no_search" },
					};
				}
				const entry = await libraryStore.update(params.name, {
					description: params.description,
					params: params.params,
					code: params.code,
					category: params.category,
					tags: params.tags,
				});
				if (!entry) {
					return { content: [{ type: "text", text: `Функцію "${params.name}" не знайдено.` }], details: { modified: false } };
				}
				return {
					content: [{ type: "text", text: `Оновлено функцію "${entry.name}".` }],
					details: { modified: true, entry: { ...entry, embedding: undefined } },
				};
			},
		},
		{
			name: "library_list",
			label: "library_list",
			description: "Список усіх функцій бібліотеки (або за категорією).",
			promptSnippet: "List library functions",
			parameters: listSchema,
			async execute(_id, params: Static<typeof listSchema>) {
				const entries = libraryStore.list(params.category);
				if (entries.length === 0) {
					return { content: [{ type: "text", text: "Бібліотека порожня." }], details: { entries: [] } };
				}
				const lines = entries.map(
					(e) => `${e.name} [${e.category ?? "uncat"}]: ${e.description}`,
				);
				return { content: [{ type: "text", text: `Функцій: ${entries.length}\n${lines.join("\n")}` }], details: { entries } };
			},
		},

		// ===== Сесійні скрипти (задачоспецифічні «чорновики») =====

		{
			name: "session_script_create",
			label: "session_script_create",
			description:
				"Створити сесійний скрипт — задачоспецифічну логіку, що живе з сесією (НЕ засмічує глобал). " +
				"Без вимоги library_search. Для разового/специфічного. Може викликати інші через ctx.call.",
			promptSnippet: "Create a session-scoped script",
			parameters: sessionCreateSchema,
			async execute(_id, params: Static<typeof sessionCreateSchema>) {
				const store = getSessionScriptStore(sessionId);
				const entry = await store.create({
					name: params.name,
					description: params.description,
					params: params.params,
					code: params.code,
					tags: params.tags,
				});
				return {
					content: [{ type: "text", text: `Створено сесійний скрипт "${entry.name}". Виклич через session_script_call. Якщо виявиться загальним — promote_to_global.` }],
					details: { created: true, entry: { ...entry, embedding: undefined } },
				};
			},
		},
		{
			name: "session_script_call",
			label: "session_script_call",
			description:
				"Виконати сесійний скрипт за імʼям з params. Без обмежень.",
			promptSnippet: "Call a session script",
			parameters: sessionCallSchema,
			async execute(_id, params: Static<typeof sessionCallSchema>) {
				const store = getSessionScriptStore(sessionId);
				let result: unknown;
				try {
					result = await store.run(params.name, params.params, deps);
				} catch (err) {
					throw new Error(hintRuntimeError(err));
				}
				const text = typeof result === "string" ? result : JSON.stringify(result, null, 2);
				return { content: [{ type: "text", text }], details: { result } };
			},
		},
		{
			name: "session_script_modify",
			label: "session_script_modify",
			description:
				"Оновити сесійний скрипт (code/description/params/tags). Без вимоги search.",
			promptSnippet: "Modify a session script",
			parameters: sessionModifySchema,
			async execute(_id, params: Static<typeof sessionModifySchema>) {
				const store = getSessionScriptStore(sessionId);
				const entry = await store.update(params.name, {
					description: params.description,
					params: params.params,
					code: params.code,
					tags: params.tags,
				});
				if (!entry) {
					return { content: [{ type: "text", text: `Сесійний скрипт "${params.name}" не знайдено.` }], details: { modified: false } };
				}
				return { content: [{ type: "text", text: `Оновлено сесійний скрипт "${entry.name}". Тепер виконай session_script_call(name, params) щоб перевірити що працює — не модифікуй повторно без перевірки.` }], details: { modified: true } };
			},
		},
		{
			name: "session_script_list",
			label: "session_script_list",
			description: "Список сесійних скриптів поточної сесії.",
			promptSnippet: "List session scripts",
			parameters: sessionListSchema,
			async execute() {
				const store = getSessionScriptStore(sessionId);
				const entries = store.list();
				if (entries.length === 0) {
					return { content: [{ type: "text", text: "Сесійних скриптів немає." }], details: { entries: [] } };
				}
				const lines = entries.map((e) => `${e.name}: ${e.description}`);
				return { content: [{ type: "text", text: `Сесійних скриптів: ${entries.length}\n${lines.join("\n")}` }], details: { entries } };
			},
		},
		{
			name: "promote_to_global",
			label: "promote_to_global",
			description:
				"Опублікувати сесійний скрипт у глобальну бібліотеку (дія куратора). ОБХОДИТЬ search-flow. " +
				"Використовуй коли сесійний скрипт виявився загальним. Якщо global name вже існує — помилка 409.",
			promptSnippet: "Promote a session script to global",
			parameters: promoteSchema,
			async execute(_id, params: Static<typeof promoteSchema>) {
				const store = getSessionScriptStore(sessionId);
				const entry = store.get(params.name);
				if (!entry) {
					return { content: [{ type: "text", text: `Сесійний скрипт "${params.name}" не знайдено.` }], details: { promoted: false } };
				}
				const code = store.readCode(params.name) ?? "";
				try {
					const promoted = await libraryStore.create({
						name: params.name,
						description: entry.description,
						params: entry.params,
						code,
						category: params.category,
						tags: entry.tags,
					});
					return {
						content: [{ type: "text", text: `Опубліковано "${promoted.name}" в глобальну бібліотеку [${promoted.category ?? "uncat"}]. Тепер доступна через library_call.` }],
						details: { promoted: true, entry: { ...promoted, embedding: undefined } },
					};
				} catch (e) {
					const msg = e instanceof Error ? e.message : String(e);
					return { content: [{ type: "text", text: `Не вдалося опублікувати: ${msg}` }], details: { promoted: false, error: msg } };
				}
			},
		},
	];

	return defs.map((d) => wrapToolDefinition(d));
}

// ===== HTTP-хендлери (CRUD + search + run) =====

/** Прочитати JSON-тіло. */
async function readBody(req: IncomingMessage): Promise<Record<string, unknown> | null> {
	const chunks: Buffer[] = [];
	for await (const chunk of req) {
		chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
	}
	const raw = Buffer.concat(chunks).toString("utf-8").trim();
	if (!raw) return null;
	try {
		return JSON.parse(raw) as Record<string, unknown>;
	} catch {
		return null;
	}
}

function sendJson(res: ServerResponse, status: number, data: unknown): void {
	res.setHeader("Content-Type", "application/json");
	res.writeHead(status);
	res.end(JSON.stringify(data));
}

/** GET /api/library — список усіх функцій (маніфест без коду). */
export function handleLibraryList(req: IncomingMessage, res: ServerResponse): boolean {
	if (req.method !== "GET") return false;
	const entries = libraryStore.list();
	// Не віддавати embeddings (великий payload) — лише метадані.
	sendJson(res, 200, {
		functions: entries.map((e) => ({
			name: e.name,
			category: e.category,
			description: e.description,
			params: e.params,
			tags: e.tags,
			createdAt: e.createdAt,
			updatedAt: e.updatedAt,
		})),
	});
	return true;
}

/** GET /api/library/:name — одна функція (з кодом). name з URL. */
export function handleLibraryGet(req: IncomingMessage, res: ServerResponse, name: string): boolean {
	if (req.method !== "GET") return false;
	const entry = libraryStore.get(name);
	if (!entry) {
		sendJson(res, 404, { error: "Функцію не знайдено" });
		return true;
	}
	const code = libraryStore.readCode(name) ?? "";
	sendJson(res, 200, {
		name: entry.name,
		category: entry.category,
		description: entry.description,
		params: entry.params,
		tags: entry.tags,
		code,
		createdAt: entry.createdAt,
		updatedAt: entry.updatedAt,
	});
	return true;
}

/** POST /api/library/search body {query} — семантичний пошук. */
export async function handleLibrarySearch(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
	if (req.method !== "POST") return false;
	const body = await readBody(req);
	const query = typeof body?.query === "string" ? body.query : null;
	if (!query) {
		sendJson(res, 400, { error: "Потрібне поле query" });
		return true;
	}
	const results = await libraryStore.search(query);
	sendJson(res, 200, { results });
	return true;
}

/** POST /api/library body {name, description, params, code, category?, tags?} — create. */
export async function handleLibraryCreate(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
	if (req.method !== "POST") return false;
	const body = await readBody(req);
	const name = typeof body?.name === "string" ? body.name : null;
	const description = typeof body?.description === "string" ? body.description : null;
	const code = typeof body?.code === "string" ? body.code : null;
	if (!name || !description || !code) {
		sendJson(res, 400, { error: "Потрібні поля name, description, code" });
		return true;
	}
	const category = typeof body?.category === "string" && body.category.trim() ? body.category.trim() : undefined;
	const tags = Array.isArray(body?.tags) ? (body.tags as unknown[]).filter((t): t is string => typeof t === "string") : [];
	const params = body?.params && typeof body.params === "object" ? (body.params as Record<string, unknown>) : undefined;
	try {
		const entry = await libraryStore.create({ name, description, code, category, tags, params: params as never });
		sendJson(res, 201, { ...entry, embedding: undefined });
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		const status = msg.includes("вже існує") ? 409 : 400;
		sendJson(res, status, { error: msg });
	}
	return true;
}

/** PATCH /api/library/:name — modify. */
export async function handleLibraryUpdate(req: IncomingMessage, res: ServerResponse, name: string): Promise<boolean> {
	if (req.method !== "PATCH") return false;
	const body = await readBody(req);
	const patch: {
		description?: string;
		params?: Record<string, unknown>;
		code?: string;
		category?: string;
		tags?: string[];
	} = {};
	if (typeof body?.description === "string") patch.description = body.description;
	if (typeof body?.code === "string") patch.code = body.code;
	if (typeof body?.category === "string") patch.category = body.category;
	if (Array.isArray(body?.tags)) patch.tags = (body.tags as unknown[]).filter((t): t is string => typeof t === "string");
	if (body?.params && typeof body.params === "object") patch.params = body.params as Record<string, unknown>;
	const entry = await libraryStore.update(name, patch as { description?: string; params?: import("@coudycode/library").ParamsSpec; code?: string; category?: string; tags?: string[] });
	if (!entry) {
		sendJson(res, 404, { error: "Функцію не знайдено" });
		return true;
	}
	sendJson(res, 200, { ...entry, embedding: undefined });
	return true;
}

/** DELETE /api/library/:name — delete. */
export function handleLibraryDelete(req: IncomingMessage, res: ServerResponse, name: string): boolean {
	if (req.method !== "DELETE") return false;
	const ok = libraryStore.delete(name);
	if (!ok) {
		sendJson(res, 404, { error: "Функцію не знайдено" });
		return true;
	}
	sendJson(res, 200, { ok: true });
	return true;
}

/** POST /api/library/:name/run body {params} — виконати (для тестування з UI). */
export async function handleLibraryRun(req: IncomingMessage, res: ServerResponse, name: string): Promise<boolean> {
	if (req.method !== "POST") return false;
	const body = await readBody(req);
	const params = body?.params && typeof body.params === "object" ? (body.params as Record<string, unknown>) : {};
	try {
		const result = await libraryStore.run(name, params, libDeps(process.cwd()));
		sendJson(res, 200, { result });
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		sendJson(res, 500, { error: msg });
	}
	return true;
}

/**
 * Ініціалізувати бібліотеку: розігріти embeddings-модель (фоново, без блокування старту).
 * Викликається з server.start() опціонально.
 */
export async function warmupEmbeddings(): Promise<void> {
	try {
		await libraryStore.search("__warmup__").catch(() => undefined);
	} catch {
		/* warmup не критичний */
	}
}

/** Re-export для інших модулів сервера. */
export { LibraryStore, SessionScriptStore };

// ===== HTTP-хендлери сесійних скриптів (CRUD + run + promote) =====
// Сховище: ~/.coudycode/session-scripts/<sessionId>/

/** GET /api/sessions/:id/scripts — список сесійних скриптів. */
export function handleSessionScriptList(req: IncomingMessage, res: ServerResponse, sessionId: string): boolean {
	if (req.method !== "GET") return false;
	const store = getSessionScriptStore(sessionId);
	const entries = store.list();
	sendJson(res, 200, {
		scripts: entries.map((e) => ({
			name: e.name,
			category: e.category,
			description: e.description,
			params: e.params,
			tags: e.tags,
			createdAt: e.createdAt,
			updatedAt: e.updatedAt,
		})),
	});
	return true;
}

/** GET /api/sessions/:id/scripts/:name — один сесійний скрипт (з кодом). */
export function handleSessionScriptGet(req: IncomingMessage, res: ServerResponse, sessionId: string, name: string): boolean {
	if (req.method !== "GET") return false;
	const store = getSessionScriptStore(sessionId);
	const entry = store.get(name);
	if (!entry) {
		sendJson(res, 404, { error: "Сесійний скрипт не знайдено" });
		return true;
	}
	const code = store.readCode(name) ?? "";
	sendJson(res, 200, {
		name: entry.name,
		category: entry.category,
		description: entry.description,
		params: entry.params,
		tags: entry.tags,
		code,
		createdAt: entry.createdAt,
		updatedAt: entry.updatedAt,
	});
	return true;
}

/** POST /api/sessions/:id/scripts — create сесійного скрипта. */
export async function handleSessionScriptCreate(req: IncomingMessage, res: ServerResponse, sessionId: string): Promise<boolean> {
	if (req.method !== "POST") return false;
	const body = await readBody(req);
	const name = typeof body?.name === "string" ? body.name : null;
	const description = typeof body?.description === "string" ? body.description : null;
	const code = typeof body?.code === "string" ? body.code : null;
	if (!name || !description || !code) {
		sendJson(res, 400, { error: "Потрібні поля name, description, code" });
		return true;
	}
	const tags = Array.isArray(body?.tags) ? (body.tags as unknown[]).filter((t): t is string => typeof t === "string") : [];
	const params = body?.params && typeof body.params === "object" ? (body.params as Record<string, unknown>) : undefined;
	const store = getSessionScriptStore(sessionId);
	try {
		const entry = await store.create({ name, description, code, tags, params: params as never });
		sendJson(res, 201, { ...entry, embedding: undefined });
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		const status = msg.includes("вже існує") ? 409 : 400;
		sendJson(res, status, { error: msg });
	}
	return true;
}

/** PATCH /api/sessions/:id/scripts/:name — modify сесійного скрипта. */
export async function handleSessionScriptUpdate(req: IncomingMessage, res: ServerResponse, sessionId: string, name: string): Promise<boolean> {
	if (req.method !== "PATCH") return false;
	const body = await readBody(req);
	const patch: {
		description?: string;
		params?: Record<string, unknown>;
		code?: string;
		category?: string;
		tags?: string[];
	} = {};
	if (typeof body?.description === "string") patch.description = body.description;
	if (typeof body?.code === "string") patch.code = body.code;
	if (typeof body?.category === "string") patch.category = body.category;
	if (Array.isArray(body?.tags)) patch.tags = (body.tags as unknown[]).filter((t): t is string => typeof t === "string");
	if (body?.params && typeof body.params === "object") patch.params = body.params as Record<string, unknown>;
	const store = getSessionScriptStore(sessionId);
	const entry = await store.update(name, patch as { description?: string; params?: import("@coudycode/library").ParamsSpec; code?: string; category?: string; tags?: string[] });
	if (!entry) {
		sendJson(res, 404, { error: "Сесійний скрипт не знайдено" });
		return true;
	}
	sendJson(res, 200, { ...entry, embedding: undefined });
	return true;
}

/** DELETE /api/sessions/:id/scripts/:name — delete сесійного скрипта. */
export function handleSessionScriptDelete(req: IncomingMessage, res: ServerResponse, sessionId: string, name: string): boolean {
	if (req.method !== "DELETE") return false;
	const store = getSessionScriptStore(sessionId);
	const ok = store.delete(name);
	if (!ok) {
		sendJson(res, 404, { error: "Сесійний скрипт не знайдено" });
		return true;
	}
	sendJson(res, 200, { ok: true });
	return true;
}

/** POST /api/sessions/:id/scripts/:name/run body {params} — виконати сесійний скрипт. */
export async function handleSessionScriptRun(req: IncomingMessage, res: ServerResponse, sessionId: string, name: string): Promise<boolean> {
	if (req.method !== "POST") return false;
	const body = await readBody(req);
	const params = body?.params && typeof body.params === "object" ? (body.params as Record<string, unknown>) : {};
	const store = getSessionScriptStore(sessionId);
	try {
		const result = await store.run(name, params, libDeps(process.cwd()));
		sendJson(res, 200, { result });
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		const status = msg.includes("не знайдено") ? 404 : 500;
		sendJson(res, status, { error: msg });
	}
	return true;
}

/** POST /api/sessions/:id/scripts/:name/promote — копіювати сесійний скрипт у глобал. */
export async function handleSessionScriptPromote(req: IncomingMessage, res: ServerResponse, sessionId: string, name: string): Promise<boolean> {
	if (req.method !== "POST") return false;
	const body = await readBody(req);
	const store = getSessionScriptStore(sessionId);
	const entry = store.get(name);
	if (!entry) {
		sendJson(res, 404, { error: "Сесійний скрипт не знайдено" });
		return true;
	}
	const code = store.readCode(name) ?? "";
	const category = typeof body?.category === "string" && body.category.trim() ? body.category.trim() : undefined;
	try {
		const promoted = await libraryStore.create({
			name,
			description: entry.description,
			params: entry.params,
			code,
			category,
			tags: entry.tags,
		});
		sendJson(res, 201, { ...promoted, embedding: undefined });
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		const status = msg.includes("вже існує") ? 409 : 400;
		sendJson(res, status, { error: msg });
	}
	return true;
}
