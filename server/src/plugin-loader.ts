/**
 * Plugin loader: auto-discover плагінів у plugins/*,
 * читання plugin.json, dynamic import backend-entry, lifecycle activate/deactivate.
 *
 * Persisted enable/disable: ~/.coudycode/plugins-state.json (overrides).
 * Hot activate/deactivate: кожен плагін отримує scoped HookEngine, що відстежує
 * реєстрації (addAction/addFilter) → при деактивації вони bulk-прибираються,
 * тож вимкнений плагін перестає впливати на tools:register/prompt:system.
 */

import { chmodSync } from "node:fs";
import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { homedir } from "node:os";
import { createRequire } from "node:module";
import {
  HookEngine,
  type PluginBackendModule,
  type PluginContext,
  type PluginManifest,
  type PluginRegistry,
} from "@coudycode/core";

const require = createRequire(import.meta.url);

/** Версія ядра coudycode (з root package.json) для перевірки minCoreVersion. */
const CORE_VERSION: string = (() => {
  try {
    return require("../../package.json").version as string;
  } catch {
    return "0.0.0";
  }
})();

/** Базова директорія coudycode (env COUDYCODE_DIR || ~/.coudycode). */
function getCoudyDir(): string {
  const fromEnv = process.env["COUDYCODE_DIR"];
  if (fromEnv && fromEnv.trim().length > 0) return fromEnv;
  return join(homedir(), ".coudycode");
}

/** Перевірити рядок semver (major.minor.patch, опц. -prerelease). */
const SEMVER_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z-.]+)?$/;

/** kebab-case: нижній регістр, цифри, дефіси (не на початку/кінці). */
const KEBAB_RE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

/** Порівняти два semver: 1 якщо a>b, -1 якщо a<b, 0 якщо рівні. */
function compareSemver(a: string, b: string): number {
  const pa = a.split("-")[0]!.split(".").map(Number);
  const pb = b.split("-")[0]!.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const va = pa[i] ?? 0;
    const vb = pb[i] ?? 0;
    if (va > vb) return 1;
    if (va < vb) return -1;
  }
  return 0;
}

/** Валідувати маніфест плагіна. Повертає null, якщо OK, або повідомлення про помилку. */
function validateManifest(manifest: PluginManifest): string | null {
  if (typeof manifest.name !== "string" || !KEBAB_RE.test(manifest.name)) {
    return `name "${manifest.name}" не відповідає kebab-case`;
  }
  if (typeof manifest.version !== "string" || !SEMVER_RE.test(manifest.version)) {
    return `version "${manifest.version}" не є semver`;
  }
  if (manifest.minCoreVersion !== undefined) {
    if (!SEMVER_RE.test(manifest.minCoreVersion)) {
      return `minCoreVersion "${manifest.minCoreVersion}" не є semver`;
    }
    if (compareSemver(CORE_VERSION, manifest.minCoreVersion) < 0) {
      return `вимагає coudycode >= ${manifest.minCoreVersion}, поточна ${CORE_VERSION}`;
    }
  }
  if (
    manifest.permissions !== undefined &&
    (!Array.isArray(manifest.permissions) || manifest.permissions.some((p) => typeof p !== "string"))
  ) {
    return "permissions має бути масивом рядків";
  }
  if (
    manifest.dependencies !== undefined &&
    (!Array.isArray(manifest.dependencies) || manifest.dependencies.some((d) => typeof d !== "string"))
  ) {
    return "dependencies має бути масивом рядків";
  }
  return null;
}

/** Локальний реєстр стану для конкретного плагіна. */
function createRegistry(pluginName: string): PluginRegistry {
  const store = new Map<string, unknown>();
  return {
    get<T = unknown>(key: string): T | undefined {
      return store.get(`${pluginName}:${key}`) as T | undefined;
    },
    set(key: string, value: unknown): void {
      store.set(`${pluginName}:${key}`, value);
    },
    delete(key: string): void {
      store.delete(`${pluginName}:${key}`);
    },
    clear(): void {
      store.clear();
    },
    keys(): string[] {
      return Array.from(store.keys());
    },
  };
}

function createUtils(prefix: string) {
  return {
    log: (message: string, ...args: unknown[]): void =>
      console.log(`[${prefix}]`, message, ...args),
    error: (message: string, ...args: unknown[]): void =>
      console.error(`[${prefix}]`, message, ...args),
  };
}

/**
 * Persisted enable/disable overrides (~/.coudycode/plugins-state.json).
 * Effective enabled = override ?? manifest.enabled ?? true.
 */
interface PluginsState {
  overrides: Record<string, boolean>;
}

class PluginStateStore {
  private readonly filePath: string;

  constructor(coudyDir: string) {
    this.filePath = join(coudyDir, "plugins-state.json");
  }

  private async read(): Promise<PluginsState> {
    try {
      const raw = await readFile(this.filePath, "utf-8");
      const parsed = JSON.parse(raw) as Partial<PluginsState>;
      return { overrides: parsed.overrides ?? {} };
    } catch {
      return { overrides: {} };
    }
  }

  private async write(state: PluginsState): Promise<void> {
    await mkdir(join(this.filePath, ".."), { recursive: true });
    await writeFile(this.filePath, JSON.stringify(state, null, 2), { mode: 0o600 });
    try {
      chmodSync(this.filePath, 0o600);
    } catch {
      /* best-effort */
    }
  }

  /** Effective enabled = override ?? manifest.enabled ?? true. */
  async getEffective(name: string, manifestDefault: boolean | undefined): Promise<boolean> {
    const state = await this.read();
    if (name in state.overrides) return state.overrides[name]!;
    return manifestDefault ?? true;
  }

  async setOverride(name: string, enabled: boolean): Promise<void> {
    const state = await this.read();
    state.overrides[name] = enabled;
    await this.write(state);
  }
}

/**
 * Scoped HookEngine для плагіна: делегує реєстрацію (addAction/addFilter) батьківському
 * (спільному) движку, але запамʼятовує повернуті ID. doAction/applyFilters теж делегуються.
 * При deactivate — removeAll() прибирає всі реєстрації цього плагіна (і tools:register,
 * і prompt:system фільтри), тож вимкнений плагін не впливає на агента.
 */
class ScopedHookEngine extends HookEngine {
  private readonly parent: HookEngine;
  private registrations: Array<{ name: string; id: string }> = [];

  constructor(parent: HookEngine) {
    super();
    this.parent = parent;
  }

  override addAction(name: string, callback: (...args: unknown[]) => void | Promise<void>, priority = 10): string {
    const id = this.parent.addAction(name, callback, priority);
    this.registrations.push({ name, id });
    return id;
  }

  override addFilter<T = unknown>(name: string, callback: (value: T, ...args: unknown[]) => T | Promise<T>, priority = 10): string {
    const id = this.parent.addFilter<T>(name, callback, priority);
    this.registrations.push({ name, id });
    return id;
  }

  override doAction(name: string, ...args: unknown[]): Promise<void> {
    return this.parent.doAction(name, ...args);
  }

  override applyFilters<T = unknown>(name: string, value: T, ...args: unknown[]): Promise<T> {
    return this.parent.applyFilters<T>(name, value, ...args);
  }

  override has(name: string): boolean {
    return this.parent.has(name);
  }

  override count(name: string): number {
    return this.parent.count(name);
  }

  override removeAction(name: string, id: string): void {
    this.parent.removeAction(name, id);
    this.registrations = this.registrations.filter((r) => r.id !== id);
  }

  override removeFilter(name: string, id: string): void {
    this.parent.removeFilter(name, id);
    this.registrations = this.registrations.filter((r) => r.id !== id);
  }

  /** Bulk-remove всіх реєстрацій цього плагіна (action + filter). */
  removeAll(): void {
    for (const { name, id } of this.registrations) {
      this.parent.removeAction(name, id);
    }
    this.registrations = [];
  }
}

/** Завантажений плагін: маніфест + директорія + бекенд-модуль + стан. */
export interface LoadedPlugin {
  manifest: PluginManifest;
  dir: string;
  module: PluginBackendModule | null;
  /** Зараз запущений (activate викликано). */
  active: boolean;
  /** Effective enabled преференс (override ?? manifest.enabled ?? true). */
  effectiveEnabled: boolean;
  /** Scoped hooks цього плагіна (створюється при activate). */
  scope?: ScopedHookEngine;
}

export interface PluginLoaderOptions {
  pluginsDir: string;
  hooks: HookEngine;
}

export class PluginLoader {
  private plugins = new Map<string, LoadedPlugin>();
  private readonly hooks: HookEngine;
  private readonly pluginsDir: string;
  private readonly state: PluginStateStore;

  constructor(opts: PluginLoaderOptions) {
    this.hooks = opts.hooks;
    this.pluginsDir = opts.pluginsDir;
    this.state = new PluginStateStore(getCoudyDir());
  }

  /** Auto-discover: знайти всі plugins/<name>/ та активувати увімкнені (effective). */
  async loadAll(): Promise<void> {
    let entries: import("node:fs").Dirent[];
    try {
      entries = await readdir(this.pluginsDir, { withFileTypes: true });
    } catch {
      // Папки plugins/ може не існувати — це нормально для чистого ядра.
      console.warn("[plugin-loader] Папка плагінів не знайдена:", this.pluginsDir);
      return;
    }

    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
      const dir = join(this.pluginsDir, entry.name);
      try {
        await this.loadOne(dir);
      } catch (err) {
        console.error(`[plugin-loader] Не вдалося завантажити "${entry.name}":`, err);
      }
    }
  }

  /** Завантажити маніфест + модуль, зареєструвати в map, активувати якщо effective enabled. */
  private async loadOne(dir: string): Promise<void> {
    const manifestPath = join(dir, "plugin.json");
    const raw = await readFile(manifestPath, "utf-8");
    const manifest = JSON.parse(raw) as PluginManifest;

    // Валідація маніфесту: невалідний → warning + skip.
    const validationError = validateManifest(manifest);
    if (validationError) {
      console.warn(`[plugin-loader] "${dir}" пропущено: ${validationError}`);
      return;
    }

    const effectiveEnabled = await this.state.getEffective(manifest.name, manifest.enabled);

    // Завантажити модуль (навіть для вимкнених — щоб можна було hot-увімкнути).
    let module: PluginBackendModule | null = null;
    const backendEntry = manifest.entry?.backend;
    if (backendEntry) {
      const entryPath = resolve(dir, backendEntry);
      const imported = await import(pathToFileURL(entryPath).href);
      module = imported as PluginBackendModule;
    }

    this.plugins.set(manifest.name, {
      manifest,
      dir,
      module,
      active: false,
      effectiveEnabled,
    });

    if (effectiveEnabled) {
      await this.activate(manifest.name);
    } else {
      console.log(`[plugin-loader] "${manifest.name}" вимкнено — пропускаю`);
    }
  }

  /** Побудувати контекст активації зі scoped hooks. */
  private buildContext(plugin: LoadedPlugin): PluginContext {
    const scope = plugin.scope ?? new ScopedHookEngine(this.hooks);
    plugin.scope = scope;
    return {
      hooks: scope,
      registry: createRegistry(plugin.manifest.name),
      utils: createUtils(`plugin:${plugin.manifest.name}`),
      pluginPath: plugin.dir,
      manifest: plugin.manifest,
    };
  }

  /** Hot-активувати плагін: викликати activate(ctx), позначити active. */
  async activate(name: string): Promise<{ ok: true } | { ok: false; error: string }> {
    const plugin = this.plugins.get(name);
    if (!plugin) return { ok: false, error: `Плагін "${name}" не знайдено` };
    if (plugin.active) return { ok: true };
    if (!plugin.module?.activate) {
      plugin.active = true;
      return { ok: true };
    }
    try {
      const context = this.buildContext(plugin);
      await plugin.module.activate(context);
      plugin.active = true;
      plugin.effectiveEnabled = true;
      await this.hooks.doAction("plugin:activate", name);
      console.log(`[plugin-loader] "${name}" активовано`);
      return { ok: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[plugin-loader] Помилка активації "${name}":`, msg);
      return { ok: false, error: msg };
    }
  }

  /** Hot-деактивувати плагін: deactivate(ctx) + bulk-remove хуків, позначити inactive. */
  async deactivate(name: string): Promise<{ ok: true } | { ok: false; error: string }> {
    const plugin = this.plugins.get(name);
    if (!plugin) return { ok: false, error: `Плагін "${name}" не знайдено` };
    if (!plugin.active) return { ok: true };
    try {
      const context = this.buildContext(plugin);
      if (plugin.module?.deactivate) {
        await plugin.module.deactivate(context);
      }
      // Bulk-remove усіх реєстрацій (tools:register, prompt:system, actions…).
      plugin.scope?.removeAll();
      plugin.active = false;
      plugin.effectiveEnabled = false;
      await this.hooks.doAction("plugin:deactivate", name);
      console.log(`[plugin-loader] "${name}" деактивовано`);
      return { ok: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[plugin-loader] Помилка деактивації "${name}":`, msg);
      return { ok: false, error: msg };
    }
  }

  /** Увімкнути (persisted override true) + hot-activate. */
  async enable(name: string): Promise<{ ok: true } | { ok: false; error: string }> {
    const plugin = this.plugins.get(name);
    if (!plugin) return { ok: false, error: `Плагін "${name}" не знайдено` };
    await this.state.setOverride(name, true);
    return this.activate(name);
  }

  /** Вимкнути (persisted override false) + hot-deactivate. */
  async disable(name: string): Promise<{ ok: true } | { ok: false; error: string }> {
    const plugin = this.plugins.get(name);
    if (!plugin) return { ok: false, error: `Плагін "${name}" не знайдено` };
    await this.state.setOverride(name, false);
    return this.deactivate(name);
  }

  /** Деактивувати всі активні плагіни у зворотному порядку (graceful shutdown). */
  async unloadAll(): Promise<void> {
    const entries = Array.from(this.plugins.entries()).reverse();
    for (const [name, plugin] of entries) {
      if (!plugin.active) continue;
      try {
        if (plugin.module?.deactivate) {
          const context = this.buildContext(plugin);
          await plugin.module.deactivate(context);
        }
        plugin.scope?.removeAll();
        plugin.active = false;
        await this.hooks.doAction("plugin:deactivate", name);
        console.log(`[plugin-loader] "${name}" деактивовано`);
      } catch (err) {
        console.error(`[plugin-loader] Помилка деактивації "${name}":`, err);
      }
    }
  }

  /** Список усіх знайдених плагінів (для API). */
  list(): LoadedPlugin[] {
    return Array.from(this.plugins.values());
  }
}
