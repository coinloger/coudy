/**
 * coudycode core — ізоморфний hook-engine + типи.
 */

import type { PluginRegistry } from "./types";

export { HookEngine, hooks } from "./hooks";
export { CoreHooks } from "./types";
export type {
  PluginManifest,
  PluginContext,
  PluginRegistry,
  PluginBackendModule,
  PluginFrontendModule,
  CoreHookName,
  HttpMethod,
  HttpRoute,
  HttpRouteContext,
  HttpRouteHandler,
} from "./types";

// Проста реалізація PluginRegistry
export class SimplePluginRegistry implements PluginRegistry {
  private store = new Map<string, unknown>();

  get<T = unknown>(key: string): T | undefined {
    return this.store.get(key) as T | undefined;
  }

  set(key: string, value: unknown): void {
    this.store.set(key, value);
  }

  delete(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }

  keys(): string[] {
    return Array.from(this.store.keys());
  }
}
