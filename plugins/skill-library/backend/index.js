/**
 * Skill Library Plugin — backend entry.
 *
 * Бібліотека функцій (skill-library): 4 уніфіковані тулзи (library_search/call/create/modify)
 * з параметром scope (global = загальне між сесіями; session = чернетки сесії).
 * Промоція session→global — через library_modify з toScope. Примусовий search-flow +
 * HTTP-роути CRUD/search/run/promote (незалежні від тулзів).
 *
 * Винесено з ядра (server/src/library.ts). Тулзи реєструються через
 * tools:register, роути — через server:routes (path-params :name/:id).
 *
 * ## Як тулзи отримують sessionId (ВАЖЛИВО — race-free патерн)
 * tools:register фільтр приймає 2-й аргумент-контекст { sessionId, cwd }
 * (ядро прокидає його через hooks.applyFilters("tools:register", base, {sessionId, cwd})).
 * Тулзи створюються з sessionId у замиканні → СВЕЖІ кожен хід, з правильним sessionId
 * для ЦІЄЇ сесії. Жодного module-level currentSessionId → без race при конкурентних чатах.
 * Search-flow скид теж тут (перший фільтр-виклик ходу = старт нового ходу).
 */

import { Type } from "typebox";
// @ts-expect-error
import { wrapToolDefinition } from "@coudycode/tools";
import { LibraryStore, SessionScriptStore, unloadEmbeddings } from "@coudycode/library";

/** Глобальний singleton store бібліотеки (один на сервер). */
const libraryStore = new LibraryStore({ rootDir: LibraryStore.coudyDir() });

/**
 * Кеш сесійних store-ів: один SessionScriptStore на сесію (теплі кеші модулів).
 * SessionScriptStore підключений до глобального store для композиції session→global.
 */
const sessionStores = new Map();

function getSessionScriptStore(sessionId) {
	let s = sessionStores.get(sessionId);
	if (!s) {
		s = new SessionScriptStore(sessionId, libraryStore);
		sessionStores.set(sessionId, s);
	}
	return s;
}

/**
 * Стан примусового search-flow: per-session флаг «був search у цьому ході».
 * Скидається на початку кожного ходу (tools:register фільтр).
 */
class SearchFlowState {
	searched = new Set();
	markSearched(sessionId) { this.searched.add(sessionId); }
	hasSearched(sessionId) { return this.searched.has(sessionId); }
	resetTurn(sessionId) { this.searched.delete(sessionId); }
}

const searchFlow = new SearchFlowState();

/**
 * Залежності для виконання функцій бібліотеки.
 * procList/procKill читаються з globalThis.__coudyProcessRegistry (ядро експортує
 * singleton під час старту); fallback — заглушка, якщо реєстр недоступний.
 */
function libDeps(cwd) {
	const reg = globalThis.__coudyProcessRegistry;
	return {
		cwd,
		procList: () => (reg ? reg.list() : []),
		procKill: (pid) => (reg ? reg.kill(pid) : false),
	};
}

// ===== Schemas =====

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

function hintRuntimeError(err) {
	const msg = err instanceof Error ? err.message : String(err);
	if (/\.exec is not a function|ctx\.sh\b.*is not a function|ctx\.\w+\.\w+ is not a function/i.test(msg)) {
		return `${msg}\n(підказка: ctx.sh — ФУНКЦІЯ, викликай \`await ctx.sh("cmd")\` → {stdout,stderr,code}; НЕ ctx.sh.exec. ctx.fs/proc/path/call теж через await.)`;
	}
	return msg;
}

/** Параметр scope: «global» = загальна бібліотека (між сесіями); «session» = чернетки цієї сесії. */
const SCOPE_DESC = "Сфера функції: «global» (загальна бібліотека, між сесіями; дефолт) або «session» (чернетки цієї сесії, живуть з нею). Без значення (у library_search/call) — шукати/резолвити в обох сферах.";

const searchSchema = Type.Object({
	query: Type.String({ description: "Опис задачі/функциональності для пошуку. Семантичний пошук за описом+тегами." }),
	scope: Type.Optional(Type.Union([Type.Literal("global"), Type.Literal("session")], { description: SCOPE_DESC })),
});
const callSchema = Type.Object({
	name: Type.String({ description: "Імʼя функції бібліотеки для виклику." }),
	params: Type.Record(Type.String(), Type.Unknown(), {
		description: "Параметри функції (обʼєкт ключ→значення відповідно до контракту функції).",
	}),
	scope: Type.Optional(Type.Union([Type.Literal("global"), Type.Literal("session")], { description: "global = лише глобальна бібліотека (дефолт); session = спершу session-сфера, при відсутності — global." })),
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
	scope: Type.Optional(Type.Union([Type.Literal("global"), Type.Literal("session")], { description: SCOPE_DESC })),
	category: Type.Optional(Type.String({ description: "Категорія (опц., лише для global): markets, git, fs, ..." })),
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
	scope: Type.Optional(Type.Union([Type.Literal("global"), Type.Literal("session")], { description: SCOPE_DESC })),
	toScope: Type.Optional(Type.Union([Type.Literal("global"), Type.Literal("session")], { description: "Перенести функцію в іншу сферу (промоція/релокація). Якщо задано і ≠ scope: функція копіюється в toScope і видаляється з поточної сфери. Напр. scope:session + toScope:global = промотувати чернетку в глобал." })),
	category: Type.Optional(Type.String()),
	tags: Type.Optional(Type.Array(Type.String())),
});

/** Вибрати store за scope: global → libraryStore, session → session-store цієї сесії. */
function storeForScope(scope, sessionId) {
	return scope === "session" ? getSessionScriptStore(sessionId) : libraryStore;
}

/**
 * Побудувати тулзи бібліотеки для конкретної сесії (session-aware search-flow).
 * sessionId — у замиканні (приходить з tools:register контексту, race-free).
 * 4 уніфіковані тулзи (library_search/create/modify/call) з параметром scope.
 */
function createLibraryTools(sessionId, cwd) {
	const deps = libDeps(cwd);

	const defs = [
		{
			name: "library_search",
			label: "library_search",
			description:
				"Пошук у бібліотеці функцій. ОБОВ\u02bcЯЗКОВИЙ перед створенням нової функції — перевикористовуй наявне. " +
				"Повертає top-K релевантних функцій з описами + параметрами + зоною (scope). Семантичний (embeddings) + keyword. " +
				"scope: «global» (дефолт) — лише глобал; «session» — лише сесійні; без значення — об\u02bcєднані session+global (з позначкою scope у кожному).",
			promptSnippet: "Search the function library (required before create)",
			parameters: searchSchema,
			async execute(_id, params) {
				// Об\u02bcєднати результати: спершу session (якщо є), потім global; з позначкою scope.
				const scope = params.scope; // undefined = обидві
				const wantSession = scope === undefined || scope === "session";
				const wantGlobal = scope === undefined || scope === "global";
				const sessionHits = wantSession ? await getSessionScriptStore(sessionId).search(params.query) : [];
				const globalHits = wantGlobal ? await libraryStore.search(params.query) : [];
				const results = [
					...sessionHits.map((r) => ({ ...r, scope: "session" })),
					...globalHits.map((r) => ({ ...r, scope: "global" })),
				];
				searchFlow.markSearched(sessionId);
				if (results.length === 0) {
					return {
						content: [{ type: "text", text: "Нічого не знайдено. Можеш створити нову функцію через library_create." }],
						details: { results: [], searched: true },
					};
				}
				const lines = results.map(
					(r, i) =>
						`${i + 1}. ${r.name} [${r.scope}/${r.category ?? "uncat"}] (score=${r.score}): ${r.description}` +
						(r.params ? `\n   params: ${JSON.stringify(r.params)}` : ""),
				);
				return {
					content: [{ type: "text", text: `Знайдено функцій: ${results.length}\n${lines.join("\n")}\n\nВиклич через library_call(name, params).` }],
					details: { results, searched: true },
				};
			},
		},
		{
			name: "library_create",
			label: "library_create",
			description:
				"Створити нову параметризовану функцію. scope: «global» (дефолт, ЗАГАЛЬНА між сесіями) або " +
				"«session» (чернетка ціє\u02bcї сесії, БЕЗ вимоги search-flow). " +
				"Для global — ВИМАГА\u02bcЄ попереднього library_search у цьому ході. Методи компонуються через ctx.call.",
			promptSnippet: "Create a new library function (global/session scope)",
			parameters: createSchema,
			async execute(_id, params) {
				const scope = params.scope === "session" ? "session" : "global";
				// search-flow лише для global
				if (scope === "global" && !searchFlow.hasSearched(sessionId)) {
					return {
						content: [{
							type: "text",
							text: "Спершу виконай library_search — можливо функція вже існує. Створення global можливе лише після пошуку. Для чернетки без вимоги search використовуй scope:\"session\".",
						}],
						details: { created: false, reason: "no_search" },
					};
				}
				const store = storeForScope(scope, sessionId);
				const entry = await store.create({
					name: params.name,
					description: params.description,
					params: params.params,
					code: params.code,
					category: params.category,
					tags: params.tags,
				});
				if (scope === "global") searchFlow.resetTurn(sessionId);
				const where = scope === "session" ? "сесійну чернетку" : "глобальну бібліотеку";
				return {
					content: [{ type: "text", text: `Створено функцію "${entry.name}" у ${where} [${entry.category ?? "uncat"}]. Тепер доступна через library_call. Виклич library_call щоб перевірити — не створюй повторно без перевірки.` }],
					details: { created: true, scope, entry: { ...entry, embedding: undefined } },
				};
			},
		},
		{
			name: "library_modify",
			label: "library_modify",
			description:
				"Оновити існуючу функцію (code/description/params/category/tags) або перенести в іншу сферу (toScope). " +
				"toScope ≠ scope — промоція/релокація: копіювати в toScope + видалити з поточно\u02bcї сфери (напр. session→global). " +
				"ВИМАГА\u02bcЄ library_search у цьому ході.",
			promptSnippet: "Modify a library function or relocate scope (promote)",
			parameters: modifySchema,
			async execute(_id, params) {
				if (!searchFlow.hasSearched(sessionId)) {
					return {
						content: [{
							type: "text",
							text: "Спершу виконай library_search перед модифікацією функції.",
						}],
						details: { modified: false, reason: "no_search" },
					};
				}
				const scope = params.scope === "session" ? "session" : "global";
				const wantRelocate = params.toScope && params.toScope !== scope;
				if (wantRelocate) {
					// Промоція/релокація: зчитати з source, записати в target, видалити з source.
					const toScope = params.toScope;
					const src = storeForScope(scope, sessionId);
					const dst = storeForScope(toScope, sessionId);
					const entry = src.get(params.name);
					if (!entry) {
						return { content: [{ type: "text", text: `Функцію "${params.name}" не знайдено в сфері ${scope}.` }], details: { relocated: false } };
					}
					const code = params.code ?? src.readCode(params.name) ?? "";
					try {
						const moved = await dst.create({
							name: params.name,
							description: params.description ?? entry.description,
							params: params.params ?? entry.params,
							code,
							category: params.category,
							tags: params.tags ?? entry.tags,
						});
						src.delete(params.name);
						const verb = (scope === "session" && toScope === "global") ? "промотовано" : "перенесено";
						return {
							content: [{ type: "text", text: `${verb === "промотовано" ? "Промотовано" : "Перенесено"} функцію "${moved.name}" із ${scope} у ${toScope} [${moved.category ?? "uncat"}]. Виклич library_call щоб перевірити.` }],
							details: { relocated: true, from: scope, to: toScope, entry: { ...moved, embedding: undefined } },
						};
					} catch (e) {
						const msg = e instanceof Error ? e.message : String(e);
						return { content: [{ type: "text", text: `Не вдалося перенести в ${toScope}: ${msg}` }], details: { relocated: false, error: msg } };
					}
				}
				// Звичайне оновлення у поточній сфері.
				const store = storeForScope(scope, sessionId);
				const entry = await store.update(params.name, {
					description: params.description,
					params: params.params,
					code: params.code,
					category: params.category,
					tags: params.tags,
				});
				if (!entry) {
					return { content: [{ type: "text", text: `Функцію "${params.name}" не знайдено в сфері ${scope}.` }], details: { modified: false } };
				}
				return {
					content: [{ type: "text", text: `Оновлено функцію "${entry.name}" (${scope}). Виклич library_call щоб перевірити — не модифікуй повторно без перевірки.` }],
					details: { modified: true, scope, entry: { ...entry, embedding: undefined } },
				};
			},
		},
		{
			name: "library_call",
			label: "library_call",
			description:
				"Виконати наявну функцію за ім\u02bcям з params. scope: «global» (дефолт) — лише глобал; " +
				"«session» — спершу session-сфера, при відсутності — global (резолв session→global). Без обмежень.",
			promptSnippet: "Call an existing library function (global/session)",
			parameters: callSchema,
			async execute(_id, params) {
				const scope = params.scope === "session" ? "session" : "global";
				let result;
				try {
					if (scope === "session") {
						// session→global: спершу session-store, при відсутності — global.
						const sessionStore = getSessionScriptStore(sessionId);
						if (sessionStore.get(params.name)) {
							result = await sessionStore.run(params.name, params.params, deps);
						} else {
							result = await libraryStore.run(params.name, params.params, deps);
						}
					} else {
						result = await libraryStore.run(params.name, params.params, deps);
					}
				} catch (err) {
					throw new Error(hintRuntimeError(err));
				}
				const text = typeof result === "string" ? result : JSON.stringify(result, null, 2);
				return { content: [{ type: "text", text }], details: { result, scope } };
			},
		},
	];

	return defs.map((d) => wrapToolDefinition({ ...d, group: "skill-library" }));
}

// ===== HTTP-роути (через server:routes, path-params в ctx.params) =====

/** Усі роути бібліотеки + сесійних скриптів. */
function libraryRoutes() {
	const r = (method, path, handler) => ({ method, path, handler });

	return [
		// --- Глобальна бібліотека ---
		r("GET", "/api/library", ({ sendJson }) => {
			const entries = libraryStore.list();
			sendJson(200, {
				functions: entries.map((e) => ({
					name: e.name, category: e.category, description: e.description,
					params: e.params, tags: e.tags, createdAt: e.createdAt, updatedAt: e.updatedAt,
				})),
			});
		}),
		r("POST", "/api/library/search", async ({ sendJson, sendError, readJsonBody }) => {
			const body = await readJsonBody();
			const query = typeof body?.query === "string" ? body.query : null;
			if (!query) { sendError(400, "Потрібне поле query"); return; }
			const results = await libraryStore.search(query);
			sendJson(200, { results });
		}),
		r("POST", "/api/library", async ({ sendJson, sendError, readJsonBody }) => {
			const body = await readJsonBody();
			const name = typeof body?.name === "string" ? body.name : null;
			const description = typeof body?.description === "string" ? body.description : null;
			const code = typeof body?.code === "string" ? body.code : null;
			if (!name || !description || !code) { sendError(400, "Потрібні поля name, description, code"); return; }
			const category = typeof body?.category === "string" && body.category.trim() ? body.category.trim() : undefined;
			const tags = Array.isArray(body?.tags) ? body.tags.filter((t) => typeof t === "string") : [];
			const params = body?.params && typeof body.params === "object" ? body.params : undefined;
			try {
				const entry = await libraryStore.create({ name, description, code, category, tags, params });
				sendJson(201, { ...entry, embedding: undefined });
			} catch (e) {
				const msg = e instanceof Error ? e.message : String(e);
				const status = msg.includes("вже існує") ? 409 : 400;
				sendError(status, msg);
			}
		}),
		r("GET", "/api/library/:name", ({ sendJson, sendError, params }) => {
			const entry = libraryStore.get(params.name);
			if (!entry) { sendError(404, "Функцію не знайдено"); return; }
			const code = libraryStore.readCode(params.name) ?? "";
			sendJson(200, {
				name: entry.name, category: entry.category, description: entry.description,
				params: entry.params, tags: entry.tags, code, createdAt: entry.createdAt, updatedAt: entry.updatedAt,
			});
		}),
		r("PATCH", "/api/library/:name", async ({ sendJson, sendError, readJsonBody, params }) => {
			const body = await readJsonBody();
			const patch = {};
			if (typeof body?.description === "string") patch.description = body.description;
			if (typeof body?.code === "string") patch.code = body.code;
			if (typeof body?.category === "string") patch.category = body.category;
			if (Array.isArray(body?.tags)) patch.tags = body.tags.filter((t) => typeof t === "string");
			if (body?.params && typeof body.params === "object") patch.params = body.params;
			const entry = await libraryStore.update(params.name, patch);
			if (!entry) { sendError(404, "Функцію не знайдено"); return; }
			sendJson(200, { ...entry, embedding: undefined });
		}),
		r("DELETE", "/api/library/:name", ({ sendJson, sendError, params }) => {
			const ok = libraryStore.delete(params.name);
			if (!ok) { sendError(404, "Функцію не знайдено"); return; }
			sendJson(200, { ok: true });
		}),
		r("POST", "/api/library/:name/run", async ({ sendJson, sendError, readJsonBody, params }) => {
			const body = await readJsonBody();
			const p = body?.params && typeof body.params === "object" ? body.params : {};
			try {
				const result = await libraryStore.run(params.name, p, libDeps(process.cwd()));
				sendJson(200, { result });
			} catch (e) {
				const msg = e instanceof Error ? e.message : String(e);
				sendError(500, msg);
			}
		}),

		// --- Сесійні скрипти: /api/sessions/:id/scripts ---
		r("GET", "/api/sessions/:id/scripts", ({ sendJson, params }) => {
			const store = getSessionScriptStore(params.id);
			const entries = store.list();
			sendJson(200, {
				scripts: entries.map((e) => ({
					name: e.name, category: e.category, description: e.description,
					params: e.params, tags: e.tags, createdAt: e.createdAt, updatedAt: e.updatedAt,
				})),
			});
		}),
		r("POST", "/api/sessions/:id/scripts", async ({ sendJson, sendError, readJsonBody, params }) => {
			const body = await readJsonBody();
			const name = typeof body?.name === "string" ? body.name : null;
			const description = typeof body?.description === "string" ? body.description : null;
			const code = typeof body?.code === "string" ? body.code : null;
			if (!name || !description || !code) { sendError(400, "Потрібні поля name, description, code"); return; }
			const tags = Array.isArray(body?.tags) ? body.tags.filter((t) => typeof t === "string") : [];
			const sp = body?.params && typeof body.params === "object" ? body.params : undefined;
			const store = getSessionScriptStore(params.id);
			try {
				const entry = await store.create({ name, description, code, tags, params: sp });
				sendJson(201, { ...entry, embedding: undefined });
			} catch (e) {
				const msg = e instanceof Error ? e.message : String(e);
				const status = msg.includes("вже існує") ? 409 : 400;
				sendError(status, msg);
			}
		}),
		r("GET", "/api/sessions/:id/scripts/:name", ({ sendJson, sendError, params }) => {
			const store = getSessionScriptStore(params.id);
			const entry = store.get(params.name);
			if (!entry) { sendError(404, "Сесійний скрипт не знайдено"); return; }
			const code = store.readCode(params.name) ?? "";
			sendJson(200, {
				name: entry.name, category: entry.category, description: entry.description,
				params: entry.params, tags: entry.tags, code, createdAt: entry.createdAt, updatedAt: entry.updatedAt,
			});
		}),
		r("PATCH", "/api/sessions/:id/scripts/:name", async ({ sendJson, sendError, readJsonBody, params }) => {
			const body = await readJsonBody();
			const patch = {};
			if (typeof body?.description === "string") patch.description = body.description;
			if (typeof body?.code === "string") patch.code = body.code;
			if (typeof body?.category === "string") patch.category = body.category;
			if (Array.isArray(body?.tags)) patch.tags = body.tags.filter((t) => typeof t === "string");
			if (body?.params && typeof body.params === "object") patch.params = body.params;
			const store = getSessionScriptStore(params.id);
			const entry = await store.update(params.name, patch);
			if (!entry) { sendError(404, "Сесійний скрипт не знайдено"); return; }
			sendJson(200, { ...entry, embedding: undefined });
		}),
		r("DELETE", "/api/sessions/:id/scripts/:name", ({ sendJson, sendError, params }) => {
			const store = getSessionScriptStore(params.id);
			const ok = store.delete(params.name);
			if (!ok) { sendError(404, "Сесійний скрипт не знайдено"); return; }
			sendJson(200, { ok: true });
		}),
		r("POST", "/api/sessions/:id/scripts/:name/run", async ({ sendJson, sendError, readJsonBody, params }) => {
			const body = await readJsonBody();
			const p = body?.params && typeof body.params === "object" ? body.params : {};
			const store = getSessionScriptStore(params.id);
			try {
				const result = await store.run(params.name, p, libDeps(process.cwd()));
				sendJson(200, { result });
			} catch (e) {
				const msg = e instanceof Error ? e.message : String(e);
				const status = msg.includes("не знайдено") ? 404 : 500;
				sendError(status, msg);
			}
		}),
		r("POST", "/api/sessions/:id/scripts/:name/promote", async ({ sendJson, sendError, readJsonBody, params }) => {
			const body = await readJsonBody();
			const store = getSessionScriptStore(params.id);
			const entry = store.get(params.name);
			if (!entry) { sendError(404, "Сесійний скрипт не знайдено"); return; }
			const code = store.readCode(params.name) ?? "";
			const category = typeof body?.category === "string" && body.category.trim() ? body.category.trim() : undefined;
			try {
				const promoted = await libraryStore.create({
					name: params.name, description: entry.description, params: entry.params, code, category, tags: entry.tags,
				});
				sendJson(201, { ...promoted, embedding: undefined });
			} catch (e) {
				const msg = e instanceof Error ? e.message : String(e);
				const status = msg.includes("вже існує") ? 409 : 400;
				sendError(status, msg);
			}
		}),
	];
}

// Шаблон-промпт «Бібліотека» (реєструється через prompt-templates:register, group skill-library).
const LIBRARY_TEMPLATE_CONTENT = [
	"Ти маєш бібліотеку функцій (skill library) — набір перевикористовуваних параметризованих функцій.",
	"",
	"## 4 інструменти + параметр scope",
	"- `library_search(query, scope?)` — пошук. Повертає функції з описами/params/зоною (scope).",
	"- `library_create(name, code, params, scope?, ...)` — створити нову функцію.",
	"- `library_modify(name, code?, params?, scope?, toScope?, ...)` — оновити або перенести в іншу сферу.",
	"- `library_call(name, params, scope?)` — виконати наявну функцію.",
	"",
	"**scope** — сфера функції:",
	"- `«global»` (дефолт) — ЗАГАЛЬНА бібліотека, між сесіями. Бібліотека, що росте.",
	"- `«session»` — чернетки ЦІЄʼЇ сесії, живуть з нею, НЕ засмічують глобал.",
	"- без значення (у search/call) — шукати/резолвити в обох сферах (спершу session, потім global).",
	"",
	"## ОБОВʼЯЗКОВИЙ FLOW",
	"Перед тим як щось робити — СПЕРШУ виконай `library_search` з описом задачі. Можливо потрібна функція вже існує.",
	"- Знайдено? → виклич `library_call(name, params)` з реальними параметрами.",
	"- Не знайдено? → лише тоді створюй нову через `library_create`.",
	"- `library_create` зі scope:«global» ВІДХИЛЯЄТЬСЯ якщо ти не зробив `library_search` у цьому ході. Для чернетки без вимоги search — scope:«session».",
	"- `library_modify` також вимагає попередній `library_search`.",
	"",
	"## Промоція / релокація (через modify)",
	"Якщо session-чернетка виявилась загальною — `library_modify(name, scope:«session», toScope:«global»)` промотує її в глобал (копіює + видаляє з session). Навпаки — локалізує.",
	"",
	"## Як писати нові функції",
	"- ЗАГАЛЬНІ та параметризовані (НЕ хардкодь конкретні значення з задачі). Напр. `delete_contract(addr)` а не `delete_my_contract()`.",
	"- global лишай ЗАГАЛЬНИМ, специфічне/разове — scope:«session».",
	"- Опис має бути конкретним — він індексується для семантичного пошуку. Теги допомагають пошуку.",
	"",
	"## Композиція",
	"Функції можуть викликати інші через `ctx.call(name, params, { scope })`. Будуй складну логіку з простих перевикористовуваних блоків.",
	"Доступні core-примітиви в ctx: ctx.fs (read/write/json), ctx.sh (shell-out: python/sqlite3/go), ctx.proc (процеси), ctx.db (sqlite path), ctx.path.",
	"",
	"## Формат модуля",
	"export const meta = { name, description, params, tags };",
	"export async function run(params, ctx) { /* тіло */ return result; }",
	"",
	"## Мета",
	"Думай СУТНОСТЯМИ (імʼя + контракт + params), а не потоком символів. Будуй бібліотеку, що росте з кожною задачею — наступного разу ти перевикористаєш наявне замість одноразового bash.",
].join("\n");


export function activate(ctx) {
	ctx.utils.log("активовано (skill-library)");

	// --- Filter: тулзи бібліотеки (race-free sessionId через 2-й аргумент контексту) ---
	// 2-й аргумент — { sessionId, cwd }, прокинутий ядром у applyFilters("tools:register", base, {sessionId, cwd}).
	ctx.hooks.addFilter("tools:register", (tools, toolCtx) => {
		const sessionId = (toolCtx && typeof toolCtx === "object" && typeof toolCtx.sessionId === "string")
			? toolCtx.sessionId : "__global__";
		const cwd = (toolCtx && typeof toolCtx === "object" && typeof toolCtx.cwd === "string")
			? toolCtx.cwd : process.cwd();
		// Скинути search-flow на початку ходу (tools:register викликається 1 раз на хід ДО prompt).
		searchFlow.resetTurn(sessionId);
		return [...tools, ...createLibraryTools(sessionId, cwd)];
	});

	// --- Filter: підказка в системний промпт ---
	ctx.hooks.addFilter("prompt:system", (prompt) => {
		return prompt + "\n\n[skill-library]: Доступна бібліотека функцій з 4 тулзами (library_search/call/create/modify) та параметром scope (global = загальне між сесіями; session = чернетки цієʼї сесії). Промоція session→global — через library_modify з toScope. Перед новою функцією — обовʼязково library_search.";
	});

	// --- Filter: роути бібліотеки (path-params :name/:id) ---
	ctx.hooks.addFilter("server:routes", (routes) => [...routes, ...libraryRoutes()]);

	// --- Filter: шаблон-промпт «Бібліотека» (group skill-library) ---
	ctx.hooks.addFilter("prompt-templates:register", (templates) => [
		...templates,
		{
			id: "skill-library:library",
			name: "Бібліотека",
			content: LIBRARY_TEMPLATE_CONTENT,
			createdAt: new Date().toISOString(),
			tools: null,
			protected: true,
			group: "skill-library",
		},
	]);
}

export async function deactivate(ctx) {
	ctx.utils.log("деактивовано (skill-library)");
	sessionStores.clear();
	try {
		await unloadEmbeddings();
	} catch {
		/* embeddings могли бути не завантажені */
	}
}
