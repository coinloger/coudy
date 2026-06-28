/**
 * Plugin loader: auto-discover плагінів у plugins/*,
 * читання plugin.json, dynamic import backend-entry, lifecycle activate/deactivate.
 */

import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
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

/** Завантажений плагін: маніфест + директорія + бекенд-модуль + стан. */
export interface LoadedPlugin {
  manifest: PluginManifest;
  dir: string;
  module: PluginBackendModule | null;
  active: boolean;
}

export interface PluginLoaderOptions {
  pluginsDir: string;
  hooks: HookEngine;
}

export class PluginLoader {
  private plugins = new Map<string, LoadedPlugin>();
  private readonly hooks: HookEngine;
  private readonly pluginsDir: string;

  constructor(opts: PluginLoaderOptions) {
    this.hooks = opts.hooks;
    this.pluginsDir = opts.pluginsDir;
  }

  /** Auto-discover: знайти всі plugins/<name>/ та активувати увімкнені. */
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

    if (manifest.enabled === false) {
      this.plugins.set(manifest.name, { manifest, dir, module: null, active: false });
      console.log(`[plugin-loader] "${manifest.name}" вимкнено — пропускаю`);
      return;
    }

    const context: PluginContext = {
      hooks: this.hooks,
      registry: createRegistry(manifest.name),
      utils: createUtils(`plugin:${manifest.name}`),
      pluginPath: dir,
      manifest,
    };

    let module: PluginBackendModule | null = null;
    const backendEntry = manifest.entry?.backend;
    if (backendEntry) {
      const entryPath = resolve(dir, backendEntry);
      const imported = await import(pathToFileURL(entryPath).href);
      module = imported as PluginBackendModule;
    }

    this.plugins.set(manifest.name, { manifest, dir, module, active: false });

    if (module?.activate) {
      await module.activate(context);
      const loaded = this.plugins.get(manifest.name)!;
      loaded.active = true;
      await this.hooks.doAction("plugin:activate", manifest.name);
      console.log(`[plugin-loader] "${manifest.name}" активовано`);
    } else {
      console.log(`[plugin-loader] "${manifest.name}" завантажено (без backend-entry)`);
    }
  }

  /** Деактивувати всі активні плагіни у зворотному порядку. */
  async unloadAll(): Promise<void> {
    const entries = Array.from(this.plugins.entries()).reverse();
    for (const [name, plugin] of entries) {
      if (!plugin.active) continue;
      const context: PluginContext = {
        hooks: this.hooks,
        registry: createRegistry(name),
        utils: createUtils(`plugin:${name}`),
        pluginPath: plugin.dir,
        manifest: plugin.manifest,
      };
      try {
        if (plugin.module?.deactivate) {
          await plugin.module.deactivate(context);
        }
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
