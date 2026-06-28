import { SimplePluginRegistry, ScopedHookEngine } from "@coudycode/core";
import type { PluginContext, PluginFrontendModule, PluginManifest } from "@coudycode/core";
import { hooks } from "./hooks";
import type { ApiPlugin, ApiPluginsResponse } from "./types";

export interface PluginLoadResult {
  name: string;
  ok: boolean;
  error?: string;
}

async function fetchPlugins(): Promise<ApiPlugin[]> {
  const res = await fetch("/api/plugins");
  if (!res.ok) throw new Error(`GET /api/plugins → HTTP ${res.status}`);
  const data: ApiPluginsResponse = await res.json();
  return data.plugins ?? [];
}

function buildManifest(p: ApiPlugin): PluginManifest {
  return {
    name: p.name,
    version: p.version,
    title: p.title,
    description: p.description,
    enabled: p.enabled,
    entry: { frontend: p.frontendEntry ?? undefined },
  };
}

/** Завантажений фронт-плагін: модуль + scoped hooks + active-стан. */
interface LoadedFrontendPlugin {
  module: PluginFrontendModule;
  scope: ScopedHookEngine;
  manifest: PluginManifest;
  active: boolean;
  /** Сировинний API-запис (для reconcile). */
  api: ApiPlugin;
}

// --- Реєстр завантажених плагінів + pub-sub реактивності ---

const loaded = new Map<string, LoadedFrontendPlugin>();
const changeListeners = new Set<() => void>();

/** Підписатись на зміну набору активних фронт-плагінів (для re-applyFilters). */
export function onPluginsChanged(fn: () => void): () => void {
  changeListeners.add(fn);
  return () => {
    changeListeners.delete(fn);
  };
}

function emitChanged(): void {
  for (const fn of changeListeners) {
    try {
      fn();
    } catch {
      /* ігноруємо помилки слухача */
    }
  }
}

function buildContext(plugin: LoadedFrontendPlugin): PluginContext {
  return {
    hooks: plugin.scope,
    registry: new SimplePluginRegistry(),
    utils: {
      log: (message: string, ...args: unknown[]) =>
        console.log(`[plugin:${plugin.manifest.name}]`, message, ...args),
      error: (message: string, ...args: unknown[]) =>
        console.error(`[plugin:${plugin.manifest.name}]`, message, ...args),
    },
    manifest: plugin.manifest,
  };
}

/** Активувати завантажений плагін (викликати його activate + позначити active). */
async function activateLoaded(plugin: LoadedFrontendPlugin): Promise<void> {
  if (plugin.active) return;
  try {
    if (plugin.module.activate) await plugin.module.activate(buildContext(plugin));
    plugin.active = true;
    console.log(`[plugins] активовано: ${plugin.manifest.name}`);
  } catch (e) {
    console.error(`[plugins] помилка активації "${plugin.manifest.name}":`, e);
  }
}

/** Деактивувати завантажений плагін (deactivate + bulk-remove scoped хуків). */
async function deactivateLoaded(plugin: LoadedFrontendPlugin): Promise<void> {
  if (!plugin.active) return;
  try {
    if (plugin.module.deactivate) await plugin.module.deactivate(buildContext(plugin));
  } catch (e) {
    console.error(`[plugins] помилка деактивації "${plugin.manifest.name}":`, e);
  }
  // Bulk-remove усіх реєстрацій цього плагіна з браузерного HookEngine.
  plugin.scope.removeAll();
  plugin.active = false;
  console.log(`[plugins] деактивовано: ${plugin.manifest.name}`);
}

/**
 * Reconcile: порівняти GET /api/plugins з теперішнім набором завантажених.
 * - ново-enabled → import + activate (scoped).
 * - ново-disabled → deactivate (scoped removal).
 * - видалені → deactivate + forget.
 * Після reconcile — emitChanged() → useCoudyUI перевикликає applyFilters.
 */
async function reconcile(emit = true): Promise<void> {
  const plugins = await fetchPlugins();
  const seen = new Set<string>();

  for (const p of plugins) {
    seen.add(p.name);
    const existing = loaded.get(p.name);

    // Плагін без frontend-entry не впливає на UI — лише запамʼятовуємо стан.
    if (!p.frontendEntry) {
      if (existing && p.active === false) await deactivateLoaded(existing);
      continue;
    }

    if (existing) {
      // Оновити active-стан (enable/disable).
      existing.api = p;
      const wantActive = p.enabled;
      if (wantActive && !existing.active) await activateLoaded(existing);
      else if (!wantActive && existing.active) await deactivateLoaded(existing);
    } else {
      // Новий плагін — import + (якщо enabled) activate.
      try {
        const mod = (await import(/* @vite-ignore */ p.frontendEntry)) as PluginFrontendModule;
        const entry: LoadedFrontendPlugin = {
          module: mod,
          scope: new ScopedHookEngine(hooks),
          manifest: buildManifest(p),
          active: false,
          api: p,
        };
        loaded.set(p.name, entry);
        if (p.enabled) await activateLoaded(entry);
      } catch (e) {
        console.error(`[plugins] помилка завантаження "${p.name}":`, e);
      }
    }
  }

  // Видалені плагіни → deactivate + forget.
  for (const [name, plugin] of loaded) {
    if (seen.has(name)) continue;
    await deactivateLoaded(plugin);
    loaded.delete(name);
    console.log(`[plugins] forget: ${name}`);
  }

  if (emit) emitChanged();
}

/**
 * Початкове завантаження фронт-плагінів. Ідемпотентно: виконується рівно один
 * раз (модульний синглтон-promise) — усуває дубль реєстрації при StrictMode
 * double-mount / hot-reload.
 */
let loadPromise: Promise<PluginLoadResult[]> | null = null;

export function loadAndActivatePlugins(): Promise<PluginLoadResult[]> {
  if (loadPromise) return loadPromise;
  loadPromise = runInitialLoad();
  return loadPromise;
}

async function runInitialLoad(): Promise<PluginLoadResult[]> {
  // Чистий старт: скидаємо реєстр перед першим завантаженням.
  hooks.clear();
  loaded.clear();
  await reconcile(false);

  const results: PluginLoadResult[] = [];
  for (const [name, plugin] of loaded) {
    results.push({ name, ok: plugin.active || !plugin.api.frontendEntry ? true : false });
    if (!plugin.api.frontendEntry && !plugin.active) {
      // Без frontend-entry — вважаємо OK (не впливає на UI).
      results[results.length - 1]!.ok = true;
    }
  }
  return results;
}

/**
 * Hot-reload: reconcile після toggle/delete + emitChanged().
 * Викликається з PluginManager → UI оновлюється ЖИВО (без F5).
 */
export async function reloadPlugins(): Promise<void> {
  await reconcile(true);
}
