import { SimplePluginRegistry } from "@coudycode/core";
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

/**
 * Завантажити фронт-плагіни: fetch /api/plugins → dynamic import(frontendEntry)
 * для увімкнених → activate(frontendContext). Повертає результати активації.
 *
 * Ідемпотентно: повне завантаження виконується рівно один раз на завантаження
 * модуля (модульний синглтон-promise). Це усуває дубль реєстрації фільтрів
 * при React.StrictMode double-mount / hot-reload: обидва виклики ефекту
 * отримують той самий promise → activate() викликається лише раз → пункт
 * плагіна з'являється рівно один раз.
 */
let loadPromise: Promise<PluginLoadResult[]> | null = null;

export function loadAndActivatePlugins(): Promise<PluginLoadResult[]> {
  if (loadPromise) return loadPromise;
  loadPromise = runLoad();
  return loadPromise;
}

async function runLoad(): Promise<PluginLoadResult[]> {
  // Скидаємо реєстр хуків перед активацією — чистий стан гарантує,
  // що фільтри плагінів не дублюються (напр. при hot-reload цього модуля).
  hooks.clear();

  const plugins = await fetchPlugins();
  const results: PluginLoadResult[] = [];

  for (const p of plugins) {
    if (!p.enabled || !p.frontendEntry) continue;
    try {
      const mod = (await import(/* @vite-ignore */ p.frontendEntry)) as PluginFrontendModule;
      const context: PluginContext = {
        hooks,
        registry: new SimplePluginRegistry(),
        utils: {
          log: (message: string, ...args: unknown[]) =>
            console.log(`[plugin:${p.name}]`, message, ...args),
          error: (message: string, ...args: unknown[]) =>
            console.error(`[plugin:${p.name}]`, message, ...args),
        },
        manifest: buildManifest(p),
      };
      if (mod.activate) await mod.activate(context);
      results.push({ name: p.name, ok: true });
      console.log(`[plugins] активовано: ${p.name}`);
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      results.push({ name: p.name, ok: false, error });
      console.error(`[plugins] помилка завантаження "${p.name}":`, e);
    }
  }

  return results;
}
