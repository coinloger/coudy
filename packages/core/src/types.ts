/**
 * Спільні типи для coudycode — використовуються і на бекенді, і на фронті.
 */

import { HookEngine } from "./hooks";

// --- Маніфест плагіна ---

/**
 * Формат plugin.json — маніфест плагіна.
 */
export interface PluginManifest {
  /** Унікальний ідентифікатор плагіна (kebab-case) */
  name: string;
  /** Семантична версія */
  version: string;
  /** Людська назва */
  title: string;
  /** Короткий опис */
  description: string;
  /** Чи активований плагін (керуються динамічно) */
  enabled?: boolean;
  /** Точка входу для бекенду (відносно plugin.json) */
  entry: {
    backend?: string;
    frontend?: string;
  };
}

// --- Контекст плагіна ---

/**
 * Контекст, що передається в activate/deactivate плагіна.
 * Містить API ядра для взаємодії.
 */
export interface PluginContext {
  /** Hook-engine для підписки на хуки */
  hooks: HookEngine;
  /** Реєстр для збереження стану плагіна */
  registry: PluginRegistry;
  /** Утиліти ядра (логування, тощо — розширюється) */
  utils: {
    log: (message: string, ...args: unknown[]) => void;
    error: (message: string, ...args: unknown[]) => void;
  };
  /** Шлях до плагіна (тільки на бекенді) */
  pluginPath?: string;
  /** Інформація про плагін з маніфесту */
  manifest: PluginManifest;
}

/**
 * Простейший реєстр для збереження стану плагіна.
 * Може бути розширений до повноцінного storage.
 */
export interface PluginRegistry {
  get<T = unknown>(key: string): T | undefined;
  set(key: string, value: unknown): void;
  delete(key: string): void;
  clear(): void;
  keys(): string[];
}

// --- Lifecycle плагіна ---

/**
 * Точки входу плагіна — що експортує модуль.
 */
export interface PluginBackendModule {
  /** Викликається при активації плагіна */
  activate?: (context: PluginContext) => void | Promise<void>;
  /** Викликається при деактивації */
  deactivate?: (context: PluginContext) => void | Promise<void>;
}

/**
 * Фронтенд модуль плагіна (для динамічного import()).
 */
export interface PluginFrontendModule {
  /** Викликається при завантаженні на клієнті */
  activate?: (context: PluginContext) => void | Promise<void>;
  /** Викликається при видалені/деактивації */
  deactivate?: (context: PluginContext) => void | Promise<void>;
}

// --- Хуки ядра (стандартні точки розширення) ---

/**
 * Назви хуків, що стріляє ядро.
 * Плагіни підписуються на них через hooks.addAction/addFilter.
 */
export const CoreHooks = {
  // Backend actions
  SERVER_START: "server:start",
  SERVER_STOP: "server:stop",
  PLUGIN_ACTIVATE: "plugin:activate",
  PLUGIN_DEACTIVATE: "plugin:deactivate",

  // Agent hooks (зарезервовано для майбутнього)
  AGENT_BEFORE_PROMPT: "agent:before-prompt",
  AGENT_AFTER_RESPONSE: "agent:after-response",
  PROMPT_SYSTEM: "prompt:system", // filter
  TOOLS_REGISTER: "tools:register", // filter
  PROVIDERS_REGISTER: "providers:register", // filter

  // Frontend filters
  UI_SIDEBAR_ITEMS: "ui:sidebar-items", // filter — пункти сайдбару від плагінів → SidebarItem[]
  UI_DASHBOARD_WIDGETS: "ui:dashboard-widgets", // filter — картки дашборду → DashboardWidget[]
  UI_ROUTES: "ui:routes", // filter — повні сторінки → Route[]
} as const;

export type CoreHookName = typeof CoreHooks[keyof typeof CoreHooks];
