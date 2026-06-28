import { useEffect, useRef, useState } from "react";
import { hooks } from "./hooks";
import { loadAndActivatePlugins } from "./plugins";
import type {
  ChatPanel,
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
  errors: string[];
}

export interface CoudyUIDefaults {
  sidebarItems: SidebarItem[];
  dashboardWidgets: DashboardWidget[];
  routes: Route[];
  settingsTabs: SettingsTab[];
  chatPanels: ChatPanel[];
  messageActions: MessageAction[];
}

/**
 * Завантажує плагіни (вони асинхно реєструють фільтри ui:*), потім
 * застосовує applyFilters до дефолтів і кладе результат у React state,
 * щоб UI перерендерився. Запускається лише один раз при монтуванні.
 */
export function useCoudyUI(defaults: CoudyUIDefaults): CoudyUIState {
  const defaultsRef = useRef(defaults);
  const [state, setState] = useState<CoudyUIState>(() => ({
    status: "loading",
    sidebarItems: defaults.sidebarItems,
    dashboardWidgets: defaults.dashboardWidgets,
    routes: defaults.routes,
    settingsTabs: defaults.settingsTabs,
    chatPanels: defaults.chatPanels,
    messageActions: defaults.messageActions,
    errors: [],
  }));

  useEffect(() => {
    const d = defaultsRef.current;
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

      const [sidebarItems, dashboardWidgets, routes, settingsTabs, chatPanels, messageActions] =
        await Promise.all([
          hooks.applyFilters<SidebarItem[]>("ui:sidebar-items", d.sidebarItems),
          hooks.applyFilters<DashboardWidget[]>("ui:dashboard-widgets", d.dashboardWidgets),
          hooks.applyFilters<Route[]>("ui:routes", d.routes),
          hooks.applyFilters<SettingsTab[]>("ui:settings-tabs", d.settingsTabs),
          hooks.applyFilters<ChatPanel[]>("ui:chat-panel", d.chatPanels),
          hooks.applyFilters<MessageAction[]>("ui:message-actions", d.messageActions),
        ]);

      if (!cancelled) {
        setState({
          status: errors.length > 0 ? "error" : "ready",
          sidebarItems,
          dashboardWidgets,
          routes,
          settingsTabs,
          chatPanels,
          messageActions,
          errors,
        });
      }
    })();

    return () => {
      cancelled = true;
    };
    // Запуск один раз при монтуванні — defaults фіксовані.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return state;
}
