import { useEffect, useRef, useState } from "react";
import { hooks } from "./hooks";
import { loadAndActivatePlugins, onPluginsChanged } from "./plugins";
import type {
  ChatPanel,
  Command,
  DashboardWidget,
  MessageAction,
  Route,
  SettingsTab,
  SidebarItem,
} from "./types";

export type LoadStatus = "loading" | "ready" | "error";

export interface CoudyUIState {
  status: LoadStatus;
  sidebarItems: SidebarItem[];
  dashboardWidgets: DashboardWidget[];
  routes: Route[];
  settingsTabs: SettingsTab[];
  chatPanels: ChatPanel[];
  messageActions: MessageAction[];
  /** Агреговані команди палітри (⌘K): core + плагіни (через ui:command-palette). */
  commands: Command[];
  errors: string[];
}

export interface CoudyUIDefaults {
  sidebarItems: SidebarItem[];
  dashboardWidgets: DashboardWidget[];
  routes: Route[];
  settingsTabs: SettingsTab[];
  chatPanels: ChatPanel[];
  messageActions: MessageAction[];
  /** Базові (вбудовані) команди палітри — плагіни розширюють через ui:command-palette. */
  commands: Command[];
}

/**
 * Завантажує плагіни (вони асинхно реєструють фільтри ui:*), потім
 * застосовує applyFilters до дефолтів і кладе результат у React state.
 *
 * Реактивність: підписується на onPluginsChanged (toggle/delete фронт-плагінів)
 * → перевикликати applyFilters → setState → UI оновлюється ЖИВО без F5.
 */
export function useCoudyUI(defaults: CoudyUIDefaults): CoudyUIState {
  const defaultsRef = useRef(defaults);
  // Тримати defaults свіжими (команди навігації/останніх сесій оновлюються).
  defaultsRef.current = defaults;
  const errorsRef = useRef<string[]>([]);
  const [state, setState] = useState<CoudyUIState>(() => ({
    status: "loading",
    sidebarItems: defaults.sidebarItems,
    dashboardWidgets: defaults.dashboardWidgets,
    routes: defaults.routes,
    settingsTabs: defaults.settingsTabs,
    chatPanels: defaults.chatPanels,
    messageActions: defaults.messageActions,
    commands: defaults.commands,
    errors: [],
  }));

  // Перевикликати applyFilters для всіх 7 ui-фільтрів → setState.
  const reapply = async (): Promise<void> => {
    const d = defaultsRef.current;
    const [
      sidebarItems,
      dashboardWidgets,
      routes,
      settingsTabs,
      chatPanels,
      messageActions,
      commands,
    ] = await Promise.all([
      hooks.applyFilters<SidebarItem[]>("ui:sidebar-items", d.sidebarItems),
      hooks.applyFilters<DashboardWidget[]>("ui:dashboard-widgets", d.dashboardWidgets),
      hooks.applyFilters<Route[]>("ui:routes", d.routes),
      hooks.applyFilters<SettingsTab[]>("ui:settings-tabs", d.settingsTabs),
      hooks.applyFilters<ChatPanel[]>("ui:chat-panel", d.chatPanels),
      hooks.applyFilters<MessageAction[]>("ui:message-actions", d.messageActions),
      hooks.applyFilters<Command[]>("ui:command-palette", d.commands),
    ]);
    setState((prev) => ({
      ...prev,
      status: errorsRef.current.length > 0 ? "error" : "ready",
      sidebarItems,
      dashboardWidgets,
      routes,
      settingsTabs,
      chatPanels,
      messageActions,
      commands,
      errors: errorsRef.current,
    }));
  };

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const errors: string[] = [];
      try {
        const results = await loadAndActivatePlugins();
        for (const r of results) {
          if (!r.ok && r.error) errors.push(`${r.name}: ${r.error}`);
        }
      } catch (e) {
        errors.push(e instanceof Error ? e.message : String(e));
      }
      errorsRef.current = errors;
      if (!cancelled) await reapply();
    })();

    // Реактивність: при зміні плагінів (toggle/delete) → re-applyFilters → setState.
    const unsubscribe = onPluginsChanged(() => {
      if (!cancelled) void reapply();
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return state;
}
