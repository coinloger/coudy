import { useEffect, useState } from "react";
import Sidebar, { type View } from "./Sidebar";
import Dashboard from "./Dashboard";
import PluginManager from "./PluginManager";
import ChatView from "./ChatView";
import Settings from "./Settings";
import { useCoudyUI } from "./useCoudyUI";
import { useSessions } from "./sessions";
import type { DashboardWidget, Route, SidebarItem } from "./types";

const COLLAPSE_KEY = "coudycode:sidebar-collapsed";

function loadCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === "1";
  } catch {
    return false;
  }
}

const defaultSidebarItems: SidebarItem[] = [];
const defaultDashboardWidgets: DashboardWidget[] = [
  {
    id: "core-shortcuts",
    title: "Швидкий старт",
    render: () => (
      <p className="small text-muted mb-0">
        Натисніть <strong>＋</strong> у сайдбарі, щоб створити нову сесію, або
        перейдіть у <strong>Плагіни</strong>, щоб переглянути екосистему.
      </p>
    ),
  },
];
const defaultRoutes: Route[] = [];

export default function App(): React.ReactNode {
  const [collapsed, setCollapsed] = useState<boolean>(() => loadCollapsed());
  const [view, setView] = useState<View>({ kind: "view", id: "dashboard" });

  const sessions = useSessions();
  const ui = useCoudyUI({
    sidebarItems: defaultSidebarItems,
    dashboardWidgets: defaultDashboardWidgets,
    routes: defaultRoutes,
  });

  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSE_KEY, collapsed ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [collapsed]);

  const handleSelectSession = (id: string): void => {
    sessions.selectSession(id);
    setView({ kind: "chat" });
  };

  const handleCreateSession = (): void => {
    sessions.createSession();
    setView({ kind: "chat" });
  };

  const activeRoute =
    view.kind === "route" ? ui.routes.find((r) => r.id === view.id) : undefined;

  let mainContent: React.ReactNode;
  if (view.kind === "chat") {
    mainContent = (
      <ChatView session={sessions.activeSession} onSend={sessions.sendMessage} />
    );
  } else if (view.kind === "view") {
    if (view.id === "dashboard") {
      mainContent = <Dashboard widgets={ui.dashboardWidgets} />;
    } else if (view.id === "plugins") {
      mainContent = <PluginManager />;
    } else {
      mainContent = <Settings />;
    }
  } else if (activeRoute) {
    mainContent = activeRoute.render();
  } else {
    mainContent = (
      <div className="p-4 text-muted">Сторінку не знайдено.</div>
    );
  }

  return (
    <div className="d-flex vh-100 overflow-hidden bg-light">
      <Sidebar
        collapsed={collapsed}
        onToggleCollapsed={() => setCollapsed((c) => !c)}
        sessions={sessions.sessions}
        activeSessionId={sessions.activeId}
        sidebarItems={ui.sidebarItems}
        view={view}
        onSelectSession={handleSelectSession}
        onCreateSession={handleCreateSession}
        onDeleteSession={sessions.deleteSession}
        onSelectView={setView}
      />

      <main className="flex-grow-1 d-flex flex-column overflow-hidden bg-white">
        {ui.errors.length > 0 && (
          <div className="alert alert-warning m-3 mb-0">
            <strong>Помилки плагінів:</strong>{" "}
            {ui.errors.join("; ")}
          </div>
        )}
        {mainContent}
      </main>
    </div>
  );
}
