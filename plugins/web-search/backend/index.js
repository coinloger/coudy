/**
 * Web Search Plugin — backend entry.
 *
 * Браузерні тулзи «web_search» + «browse» через локальний headless Chrome
 * (puppeteer-core + системний Chrome). Без зовнішніх API (ddgr/Tavily прибрано):
 * браузер САМ ходить у Bing/DuckDuckGo (web_search) або на довільний URL (browse).
 *
 * Контракт інструменту — AgentTool з @coudycode/agent-core:
 *   { name, description, parameters: TSchema, label, execute: (id, params) => AgentToolResult }
 *
 * Config: ~/.coudycode/web-search.json (0o600), { engine: "bing"|"ddg" }.
 * Routes: GET/POST /api/web-search/config.
 */

import puppeteer from "puppeteer-core";
import { existsSync } from "node:fs";
import { readFile, writeFile, mkdir, chmod } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

// @ts-expect-error — typebox у root node_modules; плагін працює в контексті сервера.
import { Type } from "typebox";

// --- Системний Chrome (macOS/Linux/Windows шляхи) ---
const CHROME_CANDIDATES = [
	"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
	"/Applications/Chromium.app/Contents/MacOS/Chromium",
	"/usr/bin/google-chrome",
	"/usr/bin/chromium",
	"/usr/bin/chromium-browser",
	"/snap/bin/chromium",
	"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
	"C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
];

function findChromePath() {
	for (const p of CHROME_CANDIDATES) {
		if (existsSync(p)) return p;
	}
	return null;
}

// Реальний User-Agent — щоб пошуковики не показували «Top Stories»/нагороди
// для бота (без UA Bing повертає нерелевантні новини, DDG html може блокуватись).
const DESKTOP_UA =
	"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

/** Декодувати обфускований URL Bing (параметр u=a1<base64>) у браузері НЕ можна (нема Buffer), тож тут. */
function decodeBingUrl(href) {
	try {
		const u = new URL(href);
		const ue = u.searchParams.get("u");
		if (ue && ue.startsWith("a1")) {
			const b64 = ue.slice(2).replace(/-/g, "+").replace(/_/g, "/");
			return Buffer.from(b64, "base64").toString("utf8");
		}
	} catch {
		/* ігноруємо */
	}
	return href;
}

/** Декодувати редирект-URL DDG (//duckduckgo.com/l/?uddg=<encoded>). */
function decodeDdgUrl(href, origin) {
	try {
		const u = new URL(href, origin);
		if (u.pathname === "/l/") {
			const uddg = u.searchParams.get("uddg");
			if (uddg) return decodeURIComponent(uddg);
		}
	} catch {
		/* ігноруємо */
	}
	return href;
}

// --- Browser singleton: ліниво піднімається, перевикористовується ---
let browserPromise = null;

async function getBrowser() {
	if (browserPromise) return browserPromise;
	const executablePath = findChromePath();
	if (!executablePath) {
		throw new Error(
			"Системний Chrome не знайдено. Встановіть Google Chrome або вкажіть шлях до нього.",
		);
	}
	browserPromise = puppeteer.launch({
		executablePath,
		headless: "new",
		args: [
			"--no-sandbox",
			"--disable-setuid-sandbox",
			"--disable-blink-features=AutomationControlled",
			"--disable-dev-shm-usage",
		],
	});
	// Дискрет: при краші браузера скинути singleton, щоб наступний виклик пересоздав.
	browserPromise.catch(() => {
		browserPromise = null;
	});
	return browserPromise;
}

// --- Config persistence ---
const WRITE_OPTIONS = { encoding: "utf-8", mode: 0o600 };

function getCoudyDir() {
	const fromEnv = process.env["COUDYCODE_DIR"];
	if (fromEnv && fromEnv.trim().length > 0) return fromEnv;
	return join(homedir(), ".coudycode");
}

const CONFIG_PATH = join(getCoudyDir(), "web-search.json");
const DEFAULT_CONFIG = { engine: "ddg" };

async function loadConfig() {
	try {
		if (!existsSync(CONFIG_PATH)) return { ...DEFAULT_CONFIG };
		const raw = (await readFile(CONFIG_PATH, "utf-8")).trim();
		if (!raw) return { ...DEFAULT_CONFIG };
		const parsed = JSON.parse(raw);
		if (!parsed || typeof parsed !== "object") return { ...DEFAULT_CONFIG };
		return { engine: parsed.engine === "bing" ? "bing" : "ddg" };
	} catch {
		return { ...DEFAULT_CONFIG };
	}
}

async function saveConfig(cfg) {
	await mkdir(dirname(CONFIG_PATH), { recursive: true });
	await writeFile(CONFIG_PATH, JSON.stringify(cfg, null, 2), WRITE_OPTIONS);
	try {
		await chmod(CONFIG_PATH, 0o600);
	} catch {
		/* chmod може не спрацювати на деяких ФС — ігноруємо */
	}
}

// --- browse тулз: URL → text сторінки ---

const browseSchema = Type.Object({
	url: Type.String({ description: "URL сторінки для читання" }),
	wait_for: Type.Optional(
		Type.String({ description: "CSS-селектор елемента, якого дочекатись (опц.)" }),
	),
	max_chars: Type.Optional(
		Type.Integer({ description: "Макс. к-ть символів тексту (default 8000)", minimum: 100, maximum: 50000 }),
	),
});

/**
 * @param {string} toolCallId
 * @param {{ url?: string; wait_for?: string; max_chars?: number }} params
 */
async function executeBrowse(toolCallId, params) {
	const url = typeof params?.url === "string" ? params.url.trim() : "";
	if (!url) {
		return {
			content: [{ type: "text", text: "Потрібен параметр url." }],
			details: { chars: 0 },
		};
	}
	const maxChars = Math.min(Math.max(Number(params?.max_chars) || 8000, 100), 50000);

	let page;
	try {
		const browser = await getBrowser();
		page = await browser.newPage();
		await page.setUserAgent(DESKTOP_UA);
		await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 });
		if (params?.wait_for) {
			await page.waitForSelector(params.wait_for, { timeout: 10000 });
		}
		const [innerText, title] = await Promise.all([
			page.evaluate(() => document.body.innerText),
			page.title(),
		]);
		const text = innerText.length > maxChars ? innerText.slice(0, maxChars) + "\n…[обрізано]" : innerText;
		return {
			content: [{ type: "text", text }],
			details: { url, title, chars: text.length },
		};
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		return {
			content: [{ type: "text", text: `Не вдалось відкрити сторінку: ${msg}` }],
			details: { url, chars: 0, error: msg },
		};
	} finally {
		try {
			await page?.close();
		} catch {
			/* ігноруємо */
		}
	}
}

const browseTool = {
	name: "browse",
	description:
		"Відкриває URL у браузері та повертає текст сторінки. Корисно для читання конкретної сторінки за посиланням (документація, стаття, ман та ін.).",
	parameters: browseSchema,
	label: "Browse URL",
	execute: executeBrowse,
};

// --- web_search тулз: Bing/DDG через браузер ---

const webSearchSchema = Type.Object({
	query: Type.String({ description: "Пошуковий запит" }),
	max_results: Type.Optional(
		Type.Integer({ description: "Макс. к-ть результатів (default 5)", minimum: 1, maximum: 25 }),
	),
	engine: Type.Optional(
		Type.Union([Type.Literal("bing"), Type.Literal("ddg")], {
			description: "Пошуковий рушій: \"bing\" (default) або \"ddg\"",
		}),
	),
});

/** Витягнути SERP з Bing-сторінки (URL-и обфусковані — декодуємо в Node). */
async function extractBing(page, maxResults) {
	const raw = await page.evaluate((max) => {
		const out = [];
		const items = document.querySelectorAll("li.b_algo");
		for (const item of items) {
			const a = item.querySelector("h2 a") || item.querySelector("a");
			const title = a?.textContent?.trim() ?? "";
			const href = a?.href ?? "";
			const snippet =
				item.querySelector(".b_caption p")?.textContent?.trim() ||
				item.querySelector("p")?.textContent?.trim() ||
				"";
			if (title || href) out.push({ title, url: href, snippet });
			if (out.length >= max) break;
		}
		return out;
	}, maxResults);
	return raw.map((r) => ({ ...r, url: decodeBingUrl(r.url) }));
}

/** Витягнути SERP з DDG html-сторінки (редирект uddg декодуємо в Node). */
async function extractDdg(page, maxResults) {
	const origin = await page.evaluate(() => location.origin);
	const raw = await page.evaluate((max) => {
		const out = [];
		const links = document.querySelectorAll(".result__a");
		for (const a of links) {
			const item = a.closest(".result, .web-result") || a;
			const title = a.textContent?.trim() ?? "";
			const href = a.href ?? "";
			const snippet = item.querySelector(".result__snippet")?.textContent?.trim() || "";
			if (title || href) out.push({ title, url: href, snippet });
			if (out.length >= max) break;
		}
		return out;
	}, maxResults);
	return raw.map((r) => ({ ...r, url: decodeDdgUrl(r.url, origin) }));
}

/** Один двигун пошуку → [{title,url,snippet}]. Кидає при помилці/порожньому. */
async function searchEngine(engine, query, maxResults) {
	const browser = await getBrowser();
	const page = await browser.newPage();
	try {
		await page.setUserAgent(DESKTOP_UA);
		const url =
			engine === "ddg"
				? `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`
				: `https://www.bing.com/search?q=${encodeURIComponent(query)}`;
		await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 });
		if (engine === "ddg") {
			await page.waitForSelector(".result__a, .result", { timeout: 10000 }).catch(() => undefined);
			const results = await extractDdg(page, maxResults);
			if (results.length === 0) throw new Error("DDG: результатів не знайдено");
			return results;
		}
		await page.waitForSelector(".b_algo", { timeout: 10000 }).catch(() => undefined);
		const results = await extractBing(page, maxResults);
		if (results.length === 0) throw new Error("Bing: результатів не знайдено");
		return results;
	} finally {
		try {
			await page.close();
		} catch {
			/* ігноруємо */
		}
	}
}

/** Людяне форматування SERP для LLM. */
function formatResults(results) {
	if (results.length === 0) return "Нічого не знайдено.";
	return results
		.map((r, i) => {
			const title = r.title || "(без заголовка)";
			const url = r.url || "";
			const snippet = r.snippet || "";
			return `${i + 1}. **${title}**\n   ${url}\n   ${snippet}`;
		})
		.join("\n\n");
}

/**
 * @param {string} toolCallId
 * @param {{ query?: string; max_results?: number; engine?: "bing"|"ddg" }} params
 */
async function executeWebSearch(toolCallId, params) {
	const query = typeof params?.query === "string" ? params.query.trim() : "";
	if (!query) {
		return {
			content: [{ type: "text", text: "Порожній запит." }],
			details: { engine: "none", count: 0 },
		};
	}
	const maxResults = Math.min(Math.max(Number(params?.max_results) || 5, 1), 25);
	const cfg = await loadConfig();
	// Пріоритет: engine з параметра > engine з конфігу; fallback на інший двигун.
	const primary = params?.engine === "ddg" || params?.engine === "bing" ? params.engine : cfg.engine;
	const secondary = primary === "ddg" ? "bing" : "ddg";

	let engine = primary;
	let lastErr = "";
	try {
		const results = await searchEngine(primary, query, maxResults);
		return {
			content: [{ type: "text", text: formatResults(results) }],
			details: { engine, count: results.length, results },
		};
	} catch (e) {
		lastErr = e instanceof Error ? e.message : String(e);
	}
	// Fallback на інший двигун.
	try {
		engine = secondary;
		const results = await searchEngine(secondary, query, maxResults);
		return {
			content: [{ type: "text", text: formatResults(results) }],
			details: { engine, count: results.length, results, fallback: true },
		};
	} catch (e) {
		const msg = `${lastErr}; fallback ${secondary}: ${e instanceof Error ? e.message : String(e)}`;
		// Перевірити: це помилка відсутності Chrome?
		if (/Chrome не знайдено|executablePath/i.test(msg)) {
			return {
				content: [
					{
						type: "text",
						text: "Системний Chrome не знайдено. Встановіть Google Chrome для вебпошуку.",
					},
				],
				details: { engine: "none", count: 0, error: msg },
			};
		}
		return {
			content: [{ type: "text", text: `Помилка пошуку: ${msg}` }],
			details: { engine: "none", count: 0, error: msg },
		};
	}
}

const webSearchTool = {
	name: "web_search",
	description:
		"Вебпошук в інтернеті за запитом (Bing/DuckDuckGo через браузер). Повертає заголовок, URL та уривок найрелевантніших результатів. Використовуй, коли потрібна актуальна інформація, якої може не бути у твоїх знаннях.",
	parameters: webSearchSchema,
	label: "Web Search",
	execute: executeWebSearch,
};

let activeCtx = null;

export function activate(ctx) {
	activeCtx = ctx;
	ctx.utils.log("активовано (web-search, headless Chrome)");

	// --- Filter: додати тулзи «web_search» + «browse» ---
	ctx.hooks.addFilter("tools:register", (tools) => {
		return [...tools, browseTool, webSearchTool];
	});

	// --- Filter: підказати агенту про доступність вебпошуку/browse ---
	ctx.hooks.addFilter("prompt:system", (prompt) => {
		return (
			prompt +
			"\n\n[web-search]: У тебе є інструменти «web_search» (пошук в інтернеті через Bing/DuckDuckGo) та «browse» (читання сторінки за URL). Використовуй їх для актуальної інформації (новини, версії, події), якої може не бути у твоїх знаннях."
		);
	});

	// --- HTTP-роути конфігу ---
	ctx.hooks.addFilter("server:routes", (routes) => {
		return [
			...routes,
			{
				method: "GET",
				path: "/api/web-search/config",
				handler: async ({ sendJson }) => {
					const cfg = await loadConfig();
					sendJson(200, cfg);
				},
			},
			{
				method: "POST",
				path: "/api/web-search/config",
				handler: async ({ sendJson, sendError, readJsonBody }) => {
					const body = await readJsonBody();
					if (!body || typeof body !== "object") {
						sendError(400, "Потрібне JSON-тіло");
						return;
					}
					const next = { engine: body.engine === "bing" ? "bing" : "ddg" };
					await saveConfig(next);
					sendJson(200, next);
				},
			},
		];
	});
}

export async function deactivate(ctx) {
	ctx.utils.log("деактивовано (web-search, закриття браузера)");
	// Закрити singleton-браузер.
	const p = browserPromise;
	browserPromise = null;
	try {
		if (p) {
			const browser = await p;
			await browser.close();
		}
	} catch {
		/* ігноруємо */
	}
	activeCtx = null;
}
