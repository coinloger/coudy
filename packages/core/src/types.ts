/**
 * Спільні типи для coudycode — використовуються і на бекенді, і на фронті.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
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
  /** Автор плагіна */
  author?: string;
  /** URL сторінки плагіна (документація/репозиторій) */
  homepage?: string;
  /** Мінімальна версія ядра coudycode (semver), з якою сумісний плагін */
  minCoreVersion?: string;
  /** Дозволи, які вимагає плагін (напр. ["fs","network","tools"]) */
  permissions?: string[];
  /** Інші плагіни, від яких залежить цей (name@version або name) */
  dependencies?: string[];
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
  /**
   * Декларувати ізольовану сесію плагіна (тільки бекенд). Конфіг застосовується
   * СТРУКТУРНО лише у цій сесії; тулзи/промпт плагіна не потрапляють у глобальний
   * HookEngine. undefined на фронті.
   */
  declareSession?: (config: PluginSessionConfig) => void;
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

// --- Сесії, що належать плагінам (plugin-owned ізольовані сесії) ---

/**
 * Декларація сесії плагіна: конфіг застосовується СТРУКТУРНО лише у цій сесії
 * (тулзи/промпт плагіна НЕ потрапляють у глобальний HookEngine взагалі).
 *
 * `tools` — масив обʼєктів інструментів (AgentTool на бекенді; тут unknown, бо core
 * не залежить від agent-core). Бекенд типізує їх як AgentTool при застосуванні.
 */
export interface PluginSessionConfig {
  /** Стабільний plugin-scoped id сесії (унікальний в межах плагіна). */
  id: string;
  /** Заголовок сесії для UI (необовʼязково). */
  title?: string;
  /** Системний промпт — ТІЛЬКИ для цієї сесії (інакше built-in). */
  systemPrompt?: string;
  /** Інструменти плагіна — ТІЛЬКИ для цієї сесії. */
  tools?: unknown[];
  /** Чи успадковувати базові інструменти (read/bash/fetch…). Дефолт: true. */
  inheritBaseTools?: boolean;
  /**
   * Живий фід контексту: викликається кожен хід, результат впроваджується
   * у systemPrompt цього ходу як <plugin_context>…</plugin_context>.
   */
  contextProvider?: () => Promise<unknown> | unknown;
}

/** Власність сесії плагіна (резидентний lookup за realSessionUuid). */
export interface PluginSessionOwnership {
  pluginName: string;
  pluginSessionId: string;
  config: PluginSessionConfig;
}

/**
 * Реєстр декларованих сесій плагінів (резидентний).
 * Ключ: "pluginName:pluginSessionId" → конфіг.
 */
export interface PluginSessionRegistry {
  /** Зареєструвати/оновити декларацію сесії плагіна. */
  declare(pluginName: string, config: PluginSessionConfig): void;
  /** Прибрати всі декларації плагіна (при деактивації). */
  removeAll(pluginName: string): void;
  /** Знайти конфіг за "pluginName:pluginSessionId". */
  get(pluginName: string, pluginSessionId: string): PluginSessionConfig | undefined;
  /** Усі декларації (для ітерації). */
  entries(): Array<{ pluginName: string; config: PluginSessionConfig }>;
}

// --- HTTP-роути від плагінів ---

/** HTTP-методи, що підтримуються плагінними роутами. */
export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/** Контекст, що передається в обробник плагінного роуту. */
export interface HttpRouteContext {
  req: IncomingMessage;
  res: ServerResponse;
  /** Надіслати JSON-відповідь із статусом. */
  sendJson: (status: number, data: unknown) => void;
  /** Надіслати помилку (status + message) як JSON. */
  sendError: (status: number, message: string) => void;
  /** Прочитати та розпарсити JSON-тіло запиту (null якщо порожнє/невалідне). */
  readJsonBody: () => Promise<unknown>;
}

/** Обробник плагінного HTTP-роуту. */
export type HttpRouteHandler = (ctx: HttpRouteContext) => void | Promise<void>;

/** Опис плагінного HTTP-ендпоінту (точний збіг method + path). */
export interface HttpRoute {
  method: HttpMethod;
  /** Точний шлях, напр. "/api/example-plugin/data". */
  path: string;
  handler: HttpRouteHandler;
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

  // Backend filters
  SERVER_ROUTES: "server:routes", // filter — HttpRoute[] від плагінів

  // Agent hooks (зарезервовано для майбутнього)
  AGENT_BEFORE_PROMPT: "agent:before-prompt",
  AGENT_AFTER_RESPONSE: "agent:after-response",
  PROMPT_SYSTEM: "prompt:system", // filter
  PROMPT_TEMPLATES_REGISTER: "prompt-templates:register", // filter — PromptTemplate[] від плагінів
  TOOLS_REGISTER: "tools:register", // filter
  PROVIDERS_REGISTER: "providers:register", // filter

  // Frontend filters
  UI_SIDEBAR_ITEMS: "ui:sidebar-items", // filter — пункти сайдбару від плагінів → SidebarItem[]
  UI_DASHBOARD_WIDGETS: "ui:dashboard-widgets", // filter — картки дашборду → DashboardWidget[]
  UI_ROUTES: "ui:routes", // filter — повні сторінки → Route[]
  UI_SETTINGS_TABS: "ui:settings-tabs", // filter — таби налаштувань → SettingsTab[]
  UI_CHAT_PANELS: "ui:chat-panel", // filter — панелі чату → ChatPanel[]
  UI_MESSAGE_ACTIONS: "ui:message-actions", // filter — дії на повідомлення → MessageAction[]
  UI_COMMAND_PALETTE: "ui:command-palette", // filter — команди палітри (⌘K) → Command[]
} as const;

export type CoreHookName = typeof CoreHooks[keyof typeof CoreHooks];
