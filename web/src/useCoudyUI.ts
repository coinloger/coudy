import { useEffect, useRef, useState } from "react";
import { hooks } from "./hooks";
import { loadAndActivatePlugins } from "./plugins";
import type {
  DashboardWidget,
  Route,
  SidebarItem,
} from "./types";

export type LoadStatus = "loading" | "ready" | "error";

export interface CoudyUIState {
  status: LoadStatus;
  sidebarItems: SidebarItem[];
  dashboardWidgets: DashboardWidget[];
  routes: Route[];
  errors: string[];
}

export interface CoudyUIDefaults {
  sidebarItems: SidebarItem[];
  dashboardWidgets: DashboardWidget[];
  routes: Route[];
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

      const [sidebarItems, dashboardWidgets, routes] = await Promise.all([
        hooks.applyFilters<SidebarItem[]>("ui:sidebar-items", d.sidebarItems),
        hooks.applyFilters<DashboardWidget[]>("ui:dashboard-widgets", d.dashboardWidgets),
        hooks.applyFilters<Route[]>("ui:routes", d.routes),
      ]);

      if (!cancelled) {
        setState({
          status: errors.length > 0 ? "error" : "ready",
          sidebarItems,
          dashboardWidgets,
          routes,
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
