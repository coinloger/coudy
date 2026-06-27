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
import { getModels, getProviders } from "@coudycode/ai";
import type { Api, Model } from "@coudycode/ai";
import { PluginLoader } from "./plugin-loader.js";

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

  constructor(opts: CoudyServerOptions) {
    this.hooks = new HookEngine();
    this.loader = new PluginLoader({ pluginsDir: opts.pluginsDir, hooks: this.hooks });
    this.port = opts.port ?? 3001;
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
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
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
      const model = this.findModel(provider, modelId);
      if (!model) {
        this.sendJson(res, 404, { error: "Модель не знайдено в каталозі" });
        return;
      }
      this.currentModel = { provider, modelId };
      this.sendJson(res, 200, this.modelInfo(model));
      return;
    }

    // /plugins/<name>/<file> — статичні файли плагінів (для dynamic import фронтендом).
    if (method === "GET" && pathname.startsWith("/plugins/")) {
      await this.servePluginFile(pathname, res);
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

  /** Каталог моделей з @coudycode/ai, згрупований за провайдером (увесь, без фільтру за ключами). */
  private buildModelCatalog(): { providers: Array<{ provider: string; models: unknown[] }> } {
    const providers = getProviders();
    return {
      providers: providers.map(provider => ({
        provider,
        models: getModels(provider).map(m => this.modelInfo(m)),
      })),
    };
  }

  /** Знайти конкретну модель у каталозі. */
  private findModel(provider: string, modelId: string): Model<Api> | undefined {
    return getModels(provider as never).find(m => m.id === modelId);
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
    const m = this.findModel(this.currentModel.provider, this.currentModel.modelId);
    return {
      provider: this.currentModel.provider,
      modelId: this.currentModel.modelId,
      label: m?.name ?? this.currentModel.modelId,
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
