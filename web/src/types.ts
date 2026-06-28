import type { ReactNode } from "react";
import type { PluginManifest } from "@coudycode/core";
import type { MessageAction } from "@coudycode/ui";

// --- Контракти API бекенду ---

export interface ApiPlugin {
  name: string;
  title: string;
  version: string;
  description: string;
  frontendEntry: string | null;
  /** Effective преференс користувача (enable/disable). */
  enabled: boolean;
  /** Зараз запущений (activate викликано). */
  active: boolean;
}

export interface ApiPluginsResponse {
  plugins: ApiPlugin[];
}

export interface ApiStateResponse {
  status: string;
  startedAt: number;
  pluginsCount: number;
}

// --- UI-елементи, що збираються через applyFilters ---

/** Пункт сайдбару, доданий плагіном (над системним футером). */
export interface SidebarItem {
  id: string;
  label: string;
  /** Назва іконки Lucide (напр. "LayoutGrid") або React-елемент. */
  icon?: string;
  /** id роуту, що відкривається при кліку. */
  routeId?: string;
}

/** Картка дашборду. */
export interface DashboardWidget {
  id: string;
  title: string;
  render: () => ReactNode;
}

/** Повна сторінка / роут. */
export interface Route {
  id: string;
  label: string;
  render: () => ReactNode;
}

/** Таба сторінки налаштувань, додана плагіном. */
export interface SettingsTab {
  id: string;
  label: string;
  /** Назва іконки Lucide (опц.). */
  icon?: string;
  /** Контент таби. */
  render: () => ReactNode;
}

/** Панель у чаті, додана плагіном. */
export interface ChatPanel {
  id: string;
  label?: string;
  render: () => ReactNode;
}

/** Реекспорт типу дії повідомлення (джерело правди — @coudycode/ui). */
export type { MessageAction };

export interface LoadedFrontendPlugin {
  manifest: PluginManifest;
  api: ApiPlugin;
}
