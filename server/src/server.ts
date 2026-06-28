/**
 * HTTP-сервер ядра: нативний Node http.
 * Власний екземпляр HookEngine для бекенду.
 * REST: GET /api/plugins, GET /api/state + віддача статичних файлів плагінів
 * (щоб фронтенд міг dynamic import() своїх бандлів).
 */

import http, {
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { normalize, join } from "node:path";
import { readFile, stat } from "node:fs/promises";
import { HookEngine } from "@coudycode/core";
import { findEnvKeys, getModels, getProviders } from "@coudycode/ai";
import type { Api, Model } from "@coudycode/ai";
import { PluginLoader } from "./plugin-loader.js";
import { AuthStorage } from "./auth/auth-storage.js";
import { ProviderDefinitions, type ApiType, type ModelDef, type ProviderDefinition } from "./auth/provider-definitions.js";
import { fetchRemoteModels } from "./auth/fetch-models.js";
import {
  buildSessionCallbacks,
  cancelSession,
  createSession,
  markDone,
  markError,
  sessionStatus,
  waitForArmed,
} from "./auth/oauth-sessions.js";
import { SessionManager } from "./sessions.js";
import { handleChat } from "./chat.js";

export interface CoudyServerOptions {
  port?: number;
  pluginsDir: string;
}

export class CoudyServer {
  private server: Server | null = null;
  private readonly hooks: HookEngine;
  private readonly loader: PluginLoader;
  private readonly port: number;
  private startedAt: number | null = null;
  // Поточна модель (in-memory; дефолт — anthropic/claude-sonnet).
  private currentModel = { provider: "anthropic", modelId: "claude-sonnet-4-20250514" };
  // Сховище облікових даних провайдерів (API-ключі).
  private readonly auth = new AuthStorage();
  // Сховище визначень кастомних провайдерів (models.json).
  private readonly providerDefs = new ProviderDefinitions();
  // Менеджер сесій (agent-core JSONL).
  private readonly sessions: SessionManager;

  constructor(opts: CoudyServerOptions) {
    this.hooks = new HookEngine();
    this.loader = new PluginLoader({ pluginsDir: opts.pluginsDir, hooks: this.hooks });
    this.port = opts.port ?? 3001;
    this.sessions = new SessionManager({
      resolveConnectedModel: (provider, modelId) => this.resolveConnectedModel(provider, modelId),
      listConnectedModels: () => this.listConnectedModels(),
    });
  }

  async start(): Promise<void> {
    // Плагіни вантажаться ДО старту HTTP, щоб server:start бачило все активне.
    await this.loader.loadAll();

    this.server = http.createServer((req, res) => {
      this.handle(req, res).catch(err => {
        console.error("[coudycode] Помилка обробки запиту:", err);
        if (!res.headersSent) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Internal server error" }));
        }
      });
    });

    await new Promise<void>(resolve => {
      this.server!.listen(this.port, () => resolve());
    });

    this.startedAt = Date.now();

    // --- Hook-точка: server:start (action) ---
    await this.hooks.doAction("server:start", this.port);

    console.log(`[coudycode] Сервер запущено: http://localhost:${this.port}`);
  }

  async stop(): Promise<void> {
    // --- Hook-точка: server:stop (action) ---
    await this.hooks.doAction("server:stop");

    await new Promise<void>(resolve => {
      if (this.server) {
        this.server.close(() => resolve());
      } else {
        resolve();
      }
    });

    await this.loader.unloadAll();
    this.startedAt = null;
    console.log("[coudycode] Сервер зупинено");
  }

  getHooks(): HookEngine {
    return this.hooks;
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", `http://localhost:${this.port}`);
    const pathname = url.pathname;
    const method = req.method ?? "GET";

    // CORS — фронтенд (Vite) живе на іншому порті.
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    if (method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    // GET /api/plugins — список активних плагінів + URL їхніх frontend-бандлів.
    if (method === "GET" && pathname === "/api/plugins") {
      const plugins = this.loader.list().map(p => ({
        name: p.manifest.name,
        title: p.manifest.title,
        version: p.manifest.version,
        description: p.manifest.description,
        frontendEntry: p.manifest.entry?.frontend
          ? `/plugins/${p.manifest.name}/${p.manifest.entry.frontend.replace(/^\.?\//, "")}`
          : null,
        enabled: p.active,
      }));
      this.sendJson(res, 200, { plugins });
      return;
    }

    // GET /api/state — базовий стан сервера.
    if (method === "GET" && pathname === "/api/state") {
      this.sendJson(res, 200, {
        status: "ok",
        startedAt: this.startedAt,
        pluginsCount: this.loader.list().filter(p => p.active).length,
      });
      return;
    }

    // GET /api/models — увесь каталог моделей (@coudycode/ai), згрупований за провайдером.
    if (method === "GET" && pathname === "/api/models") {
      this.sendJson(res, 200, this.buildModelCatalog());
      return;
    }

    // GET /api/model — поточна обрана модель.
    if (method === "GET" && pathname === "/api/model") {
      this.sendJson(res, 200, this.getCurrentModelInfo());
      return;
    }

    // POST /api/model — змінити поточну модель (body: { provider, modelId }).
    if (method === "POST" && pathname === "/api/model") {
      const body = await this.readJsonBody(req);
      const provider = typeof body?.provider === "string" ? body.provider : null;
      const modelId = typeof body?.modelId === "string" ? body.modelId : null;
      if (!provider || !modelId) {
        this.sendJson(res, 400, { error: "Потрібні поля provider та modelId" });
        return;
      }
      const info = this.resolveModelInfo(provider, modelId);
      if (!info) {
        this.sendJson(res, 404, { error: "Модель не знайдено в каталозі" });
        return;
      }
      this.currentModel = { provider, modelId };
      this.sendJson(res, 200, info);
      return;
    }

    // /plugins/<name>/<file> — статичні файли плагінів (для dynamic import фронтендом).
    if (method === "GET" && pathname.startsWith("/plugins/")) {
      await this.servePluginFile(pathname, res);
      return;
    }

    // === Auth: підключення провайдерів через API-ключ (Phase 1) ===

    // GET /api/providers — каталог провайдерів + статус налаштування (без секретів).
    if (method === "GET" && pathname === "/api/providers") {
      const providers = getProviders().map((id) => ({
        id,
        envVar: this.providerEnvVar(id),
        status: this.auth.getAuthStatus(id),
      }));
      this.sendJson(res, 200, { providers });
      return;
    }

    // GET /api/providers/:id/status — статус конкретного провайдера (без секретів).
    const statusMatch = /^\/api\/providers\/([^/]+)\/status$/.exec(pathname);
    if (method === "GET" && statusMatch) {
      const id = decodeURIComponent(statusMatch[1]);
      this.sendJson(res, 200, this.auth.getAuthStatus(id));
      return;
    }

    // POST /api/providers/:id/key — зберегти api_key.
    const keyMatch = /^\/api\/providers\/([^/]+)\/key$/.exec(pathname);
    if (method === "POST" && keyMatch) {
      const id = decodeURIComponent(keyMatch[1]);
      const body = await this.readJsonBody(req);
      const key = typeof body?.key === "string" ? body.key.trim() : null;
      if (!key) {
        this.sendJson(res, 400, { error: "Потрібне поле key" });
        return;
      }
      const env =
        body && typeof body.env === "object" && body.env !== null
          ? (body.env as Record<string, string>)
          : undefined;
      this.auth.set(id, { type: "api_key", key, ...(env ? { env } : {}) });
      this.sendJson(res, 200, this.auth.getAuthStatus(id));
      return;
    }

    // GET /api/providers/definitions — кастомні провайдери (models.json, БЕЗ ключів) + статус пресетів.
    if (method === "GET" && pathname === "/api/providers/definitions") {
      const custom = this.providerDefs.list().map((id) => ({
        id,
        custom: true,
        definition: this.providerDefs.getPublic(id),
      }));
      const presets = ["openai", "anthropic"].map((id) => ({
        id,
        custom: false,
        status: this.auth.getAuthStatus(id),
      }));
      this.sendJson(res, 200, { providers: [...custom, ...presets] });
      return;
    }

    // POST /api/providers/preset — підключити built-in пресет (openai/anthropic) ключем.
    if (method === "POST" && pathname === "/api/providers/preset") {
      const body = await this.readJsonBody(req);
      const provider = typeof body?.provider === "string" ? body.provider : null;
      const apiKey = typeof body?.apiKey === "string" ? body.apiKey.trim() : null;
      if (!provider || !apiKey) {
        this.sendJson(res, 400, { error: "Потрібні поля provider та apiKey" });
        return;
      }
      if (provider !== "openai" && provider !== "anthropic") {
        this.sendJson(res, 400, { error: "Невідомий пресет" });
        return;
      }
      this.auth.set(provider, { type: "api_key", key: apiKey });
      this.sendJson(res, 200, this.auth.getAuthStatus(provider));
      return;
    }

    // POST /api/providers/custom — зберегти кастомний провайдер у models.json.
    if (method === "POST" && pathname === "/api/providers/custom") {
      const body = await this.readJsonBody(req);
      const id = typeof body?.id === "string" ? body.id.trim() : null;
      const apiType = body?.apiType;
      const baseUrl = typeof body?.baseUrl === "string" ? body.baseUrl.trim() : null;
      const apiKey = typeof body?.apiKey === "string" ? body.apiKey.trim() : null;
      if (!id || !baseUrl || !apiKey) {
        this.sendJson(res, 400, { error: "Потрібні поля id, baseUrl, apiKey" });
        return;
      }
      if (apiType !== "anthropic-messages" && apiType !== "openai-completions" && apiType !== "openai-responses") {
        this.sendJson(res, 400, { error: "Невідомий apiType" });
        return;
      }
      const label = typeof body?.label === "string" && body.label.trim() ? body.label.trim() : undefined;
      const models = Array.isArray(body?.models) ? (body.models as ModelDef[]) : [];
      const def: ProviderDefinition = {
        baseUrl,
        api: apiType as ApiType,
        apiKey,
        ...(label ? { name: label } : {}),
        models,
      };
      this.providerDefs.set(id, def);
      this.sendJson(res, 200, { id, definition: this.providerDefs.getPublic(id) });
      return;
    }

    // POST /api/providers/:id/models/fetch — отримати моделі з {baseUrl}/v1/models.
    const fetchMatch = /^\/api\/providers\/([^/]+)\/models\/fetch$/.exec(pathname);
    if (method === "POST" && fetchMatch) {
      const body = await this.readJsonBody(req);
      const baseUrl = typeof body?.baseUrl === "string" ? body.baseUrl.trim() : null;
      const apiKey = typeof body?.apiKey === "string" ? body.apiKey.trim() : null;
      const apiType = body?.apiType;
      if (!baseUrl || !apiKey) {
        this.sendJson(res, 400, { error: "Потрібні поля baseUrl та apiKey" });
        return;
      }
      if (apiType !== "anthropic-messages" && apiType !== "openai-completions" && apiType !== "openai-responses") {
        this.sendJson(res, 400, { error: "Невідомий apiType" });
        return;
      }
      const result = await fetchRemoteModels(baseUrl, apiKey, apiType as ApiType);
      this.sendJson(res, result.error ? 422 : 200, result);
      return;
    }

    // GET /api/oauth/providers — список OAuth-провайдерів (anthropic/copilot/codex).
    if (method === "GET" && pathname === "/api/oauth/providers") {
      const providers = this.auth.getOAuthProviders().map((p) => ({
        id: p.id,
        name: p.name,
        callback: !!p.usesCallbackServer,
      }));
      this.sendJson(res, 200, { providers });
      return;
    }

    // POST /api/providers/:id/oauth/start — ініціювати OAuth-логін у фоні.
    const oauthStartMatch = /^\/api\/providers\/([^/]+)\/oauth\/start$/.exec(pathname);
    if (method === "POST" && oauthStartMatch) {
      const id = decodeURIComponent(oauthStartMatch[1]);
      if (!this.auth.isOAuthProvider(id)) {
        this.sendJson(res, 404, { error: "OAuth-провайдер не знайдено" });
        return;
      }
      const session = createSession(id);
      const callbacks = buildSessionCallbacks(id);
      // Фоновий логін: заповнює session.url/userCode, потім done/error.
      this.auth
        .login(id, callbacks)
        .then(() => markDone(id))
        .catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err);
          // Abort не вважаємо помилкою (скасування).
          if (!/abort/i.test(msg)) markError(id, msg);
        });
      // Дочекатись, поки флоу буде «озброєно» (onAuth/onDeviceCode), потім віддати URL/код.
      await waitForArmed(id);
      this.sendJson(res, 200, sessionStatus(id) ?? { status: "pending" });
      return;
    }

    // GET /api/providers/:id/oauth/poll — статус pending-сесії.
    const oauthPollMatch = /^\/api\/providers\/([^/]+)\/oauth\/poll$/.exec(pathname);
    if (method === "GET" && oauthPollMatch) {
      const id = decodeURIComponent(oauthPollMatch[1]);
      const status = sessionStatus(id);
      this.sendJson(res, 200, status ?? { status: "idle" });
      return;
    }

    // DELETE /api/oauth/pending/:id — скасувати pending OAuth-логін.
    const oauthCancelMatch = /^\/api\/oauth\/pending\/([^/]+)$/.exec(pathname);
    if (method === "DELETE" && oauthCancelMatch) {
      const id = decodeURIComponent(oauthCancelMatch[1]);
      cancelSession(id);
      this.sendJson(res, 200, { ok: true });
      return;
    }

    // DELETE /api/providers/:id — видалити: кастомний (models.json) АБО пресет (auth).
    const delMatch = /^\/api\/providers\/([^/]+)$/.exec(pathname);
    if (method === "DELETE" && delMatch) {
      const id = decodeURIComponent(delMatch[1]);
      if (this.providerDefs.has(id)) {
        this.providerDefs.remove(id);
      } else {
        this.auth.remove(id);
      }
      this.sendJson(res, 200, { ok: true });
      return;
    }

    // === Сесії (agent-core JSONL) ===

    // GET /api/sessions — список усіх сесій (метадані, без messages).
    if (method === "GET" && pathname === "/api/sessions") {
      this.sendJson(res, 200, { sessions: await this.sessions.list() });
      return;
    }

    // POST /api/chat — SSE-стрім агента (model з сесії + auth + tools + session).
    if (method === "POST" && pathname === "/api/chat") {
      const body = await this.readJsonBody(req);
      // Модель — з сесії (per-session, персистентно в JSONL).
      const sessionId = typeof body?.sessionId === "string" ? body.sessionId : "";
      const sessionFull = sessionId ? await this.sessions.get(sessionId) : null;
      const sessionModel = sessionFull?.model;
      await handleChat(
        req,
        res,
        body as { sessionId?: unknown; message?: unknown },
        this.sessions,
        this.auth,
        this.providerDefs,
        sessionModel
          ? { provider: sessionModel.provider, modelId: sessionModel.modelId }
          : null,
        process.cwd(),
      );
      return;
    }

    // POST /api/sessions — створити нову сесію (UUID id).
    if (method === "POST" && pathname === "/api/sessions") {
      const body = await this.readJsonBody(req);
      const name = typeof body?.name === "string" && body.name.trim() ? body.name.trim() : undefined;
      this.sendJson(res, 200, await this.sessions.create(name));
      return;
    }

    // GET /api/sessions/:id — повна сесія (messages).
    const sessionGetMatch = /^\/api\/sessions\/([^/]+)$/.exec(pathname);
    if (method === "GET" && sessionGetMatch) {
      const id = decodeURIComponent(sessionGetMatch[1]);
      const session = await this.sessions.get(id);
      if (!session) {
        this.sendJson(res, 404, { error: "Сесію не знайдено" });
        return;
      }
      this.sendJson(res, 200, session);
      return;
    }

    // PATCH /api/sessions/:id — перейменувати.
    if (method === "PATCH" && sessionGetMatch) {
      const id = decodeURIComponent(sessionGetMatch[1]);
      const body = await this.readJsonBody(req);
      const name = typeof body?.name === "string" ? body.name.trim() : null;
      if (!name) {
        this.sendJson(res, 400, { error: "Потрібне поле name" });
        return;
      }
      const session = await this.sessions.rename(id, name);
      if (!session) {
        this.sendJson(res, 404, { error: "Сесію не знайдено" });
        return;
      }
      this.sendJson(res, 200, session);
      return;
    }

    // POST /api/sessions/:id/model — зберегти модель сесії (запис model_change).
    const sessionModelMatch = /^\/api\/sessions\/([^/]+)\/model$/.exec(pathname);
    if (method === "POST" && sessionModelMatch) {
      const id = decodeURIComponent(sessionModelMatch[1]);
      const body = await this.readJsonBody(req);
      const provider = typeof body?.provider === "string" ? body.provider : null;
      const modelId = typeof body?.modelId === "string" ? body.modelId : null;
      if (!provider || !modelId) {
        this.sendJson(res, 400, { error: "Потрібні поля provider та modelId" });
        return;
      }
      const updated = await this.sessions.setModel(id, provider, modelId);
      if (!updated) {
        this.sendJson(res, 404, { error: "Сесію не знайдено або модель не підключено" });
        return;
      }
      this.sendJson(res, 200, updated);
      return;
    }

    // DELETE /api/sessions/:id — видалити.
    if (method === "DELETE" && sessionGetMatch) {
      const id = decodeURIComponent(sessionGetMatch[1]);
      const ok = await this.sessions.delete(id);
      if (!ok) {
        this.sendJson(res, 404, { error: "Сесію не знайдено" });
        return;
      }
      this.sendJson(res, 200, { ok: true });
      return;
    }

    this.sendJson(res, 404, { error: "Not found" });

    // --- Зарезервовані hook-точки бекенду (фіктивно активуються майбутнім кодом агента) ---
    // await this.hooks.applyFilters("prompt:system", defaultSystemPrompt);   // filter
    // await this.hooks.applyFilters("tools:register", defaultTools);          // filter
    // await this.hooks.applyFilters("providers:register", defaultProviders);  // filter
    // await this.hooks.doAction("agent:before-prompt", prompt);               // action
    // await this.hooks.doAction("agent:after-response", response);            // action
  }

  private async servePluginFile(pathname: string, res: ServerResponse): Promise<void> {
    const rel = pathname.slice("/plugins/".length);
    const parts = rel.split("/");
    const pluginName = parts[0];
    const fileRest = parts.slice(1).join("/");

    const plugin = this.loader.list().find(p => p.manifest.name === pluginName);
    if (!plugin) {
      this.sendJson(res, 404, { error: "Plugin not found" });
      return;
    }

    const baseDir = normalize(plugin.dir);
    const filePath = normalize(join(baseDir, fileRest));
    if (!filePath.startsWith(baseDir)) {
      this.sendJson(res, 403, { error: "Forbidden" });
      return;
    }

    try {
      const s = await stat(filePath);
      if (!s.isFile()) {
        this.sendJson(res, 404, { error: "Not a file" });
        return;
      }
      const data = await readFile(filePath);
      if (filePath.endsWith(".js") || filePath.endsWith(".mjs")) {
        res.setHeader("Content-Type", "application/javascript");
      } else if (filePath.endsWith(".json")) {
        res.setHeader("Content-Type", "application/json");
      } else {
        res.setHeader("Content-Type", "application/octet-stream");
      }
      res.writeHead(200);
      res.end(data);
    } catch {
      this.sendJson(res, 404, { error: "File not found" });
    }
  }

  /** Канонічне імʼя env-змінної провайдера (для підказки в каталозі), якщо виявлено. */
  private providerEnvVar(provider: string): string | null {
    const keys = findEnvKeys(provider);
    return keys && keys.length > 0 ? keys[0] : null;
  }

  /** Список усіх підключених моделей (пресети + кастомні) як SessionModel[] з labels. */
  private listConnectedModels(): { provider: string; modelId: string; label: string; contextWindow: number }[] {
    const out: { provider: string; modelId: string; label: string; contextWindow: number }[] = [];
    const catalog = this.buildModelCatalog();
    for (const g of catalog.providers) {
      for (const m of g.models as Array<{ id: string; label?: string; contextWindow: number }>) {
        out.push({ provider: g.provider, modelId: m.id, label: m.label ?? m.id, contextWindow: m.contextWindow });
      }
    }
    return out;
  }

  /** Резолвити підключену модель за {provider, modelId} → {provider, modelId, label} | null. */
  private resolveConnectedModel(provider: string, modelId: string): { provider: string; modelId: string; label: string; contextWindow: number } | null {
    const info = this.resolveModelInfo(provider, modelId);
    if (!info) return null;
    return { provider, modelId, label: info.label, contextWindow: info.contextWindow };
  }

  /** Моделі підключених провайдерів: пресети (auth → built-in каталог) + кастомні (models.json). */
  private buildModelCatalog(): { providers: Array<{ provider: string; models: unknown[] }> } {
    // (а) Пресети: auth.list() → built-in каталог @coudycode/ai.
    const presetProviders = this.auth.list();
    const providers: Array<{ provider: string; models: unknown[] }> = presetProviders.map(provider => ({
      provider,
      models: getModels(provider as never).map(m => this.modelInfo(m)),
    }));
    // (б) Кастомні провайдери (models.json).
    for (const id of this.providerDefs.list()) {
      const def = this.providerDefs.get(id);
      if (!def) continue;
      providers.push({ provider: id, models: def.models.map(m => this.customModelInfo(m, id, def)) });
    }
    return { providers };
  }

  /** Публічне представлення моделі кастомного провайдера. */
  private customModelInfo(
    m: ModelDef,
    provider: string,
    def: ProviderDefinition,
  ): {
    id: string;
    label: string;
    provider: string;
    api: string;
    contextWindow: number;
    maxTokens: number;
    reasoning: boolean;
    input: string[];
  } {
    return {
      id: m.id,
      label: m.name ?? m.id,
      provider,
      api: def.api,
      contextWindow: m.contextWindow ?? 128000,
      maxTokens: m.maxTokens ?? 16384,
      reasoning: m.reasoning ?? false,
      input: m.input ? [...m.input] : ["text"],
    };
  }

  /** Знайти модель та повернути її публічне представлення: built-in АБО кастомна (models.json). */
  private resolveModelInfo(provider: string, modelId: string): ReturnType<CoudyServer["modelInfo"]> | undefined {
    const builtIn = getModels(provider as never).find(m => m.id === modelId);
    if (builtIn) return this.modelInfo(builtIn);
    const def = this.providerDefs.get(provider);
    if (def) {
      const cm = def.models.find(m => m.id === modelId);
      if (cm) return this.customModelInfo(cm, provider, def);
    }
    return undefined;
  }

  /** Публічне представлення моделі (id + людське імʼя + метадані). */
  private modelInfo(m: Model<Api>): {
    id: string;
    label: string;
    provider: string;
    api: string;
    contextWindow: number;
    maxTokens: number;
    reasoning: boolean;
    input: string[];
  } {
    return {
      id: m.id,
      label: m.name,
      provider: m.provider,
      api: m.api,
      contextWindow: m.contextWindow,
      maxTokens: m.maxTokens,
      reasoning: m.reasoning,
      input: [...m.input],
    };
  }

  /** Поточна модель як { provider, modelId, label }. */
  private getCurrentModelInfo(): { provider: string; modelId: string; label: string } {
    const info = this.resolveModelInfo(this.currentModel.provider, this.currentModel.modelId);
    return {
      provider: this.currentModel.provider,
      modelId: this.currentModel.modelId,
      label: info?.label ?? this.currentModel.modelId,
    };
  }

  /** Прочитати JSON-тіло запиту (для POST). */
  private async readJsonBody(req: IncomingMessage): Promise<Record<string, unknown> | null> {
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

  private sendJson(res: ServerResponse, status: number, body: unknown): void {
    res.setHeader("Content-Type", "application/json");
    res.writeHead(status);
    res.end(JSON.stringify(body));
  }
}
