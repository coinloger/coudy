import { useEffect, useState } from "react";
import { Navigate, Route, Routes, useNavigate, useParams } from "react-router-dom";
import Sidebar from "./Sidebar";
import Dashboard from "./Dashboard";
import PluginManager from "./PluginManager";
import ChatView from "./ChatView";
import Settings from "./Settings";
import Playground from "./playground/Playground";
import { useCoudyUI } from "./useCoudyUI";
import { useSessions } from "./sessions";
import type { ChatSession } from "./sessions";
import type { DashboardWidget, Route as PluginRoute, SidebarItem } from "./types";

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
const defaultRoutes: PluginRoute[] = [];

export default function App(): React.ReactNode {
  const [collapsed, setCollapsed] = useState<boolean>(() => loadCollapsed());
  const navigate = useNavigate();

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
    navigate(`/chat/${id}`);
  };

  const handleCreateSession = async (): Promise<void> => {
    const id = await sessions.createSession();
    navigate(`/chat/${id}`);
  };

  return (
    <div className="d-flex vh-100 overflow-hidden bg-light">
      <Sidebar
        collapsed={collapsed}
        onToggleCollapsed={() => setCollapsed((c) => !c)}
        sessions={sessions.sessions}
        sidebarItems={ui.sidebarItems}
        onSelectSession={handleSelectSession}
        onCreateSession={handleCreateSession}
        onDeleteSession={sessions.deleteSession}
      />

      <main className="flex-grow-1 d-flex flex-column overflow-hidden bg-white">
        {ui.errors.length > 0 && (
          <div className="alert alert-warning m-3 mb-0">
            <strong>Помилки плагінів:</strong>{" "}
            {ui.errors.join("; ")}
          </div>
        )}
        <Routes>
          <Route path="/" element={<Dashboard widgets={ui.dashboardWidgets} />} />
          <Route path="/dashboard" element={<Dashboard widgets={ui.dashboardWidgets} />} />
          <Route path="/plugins" element={<PluginManager />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/playground" element={<Playground />} />
          <Route
            path="/chat/:sessionId"
            element={
              <ChatRoute
                sessions={sessions.sessions}
                activeSession={sessions.activeSession}
                selectSession={sessions.selectSession}
                sendMessage={sessions.sendMessage}
              />
            }
          />
          <Route
            path="/plugin/:routeId"
            element={<PluginRouteView routes={ui.routes} />}
          />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </main>
    </div>
  );
}

interface ChatRouteProps {
  sessions: ChatSession[];
  activeSession: ChatSession | null;
  selectSession: (id: string) => void;
  sendMessage: (content: string) => void;
}

/** Маршрут чату: сесія за /chat/:sessionId з URL. */
function ChatRoute({
  sessions,
  activeSession,
  selectSession,
  sendMessage,
}: ChatRouteProps): React.ReactNode {
  const { sessionId } = useParams();
  const session =
    sessions.find((s) => s.id === sessionId) ?? null;

  // Синхронізуємо активну сесію з URL (для sendMessage та стану сайдбару).
  useEffect(() => {
    if (sessionId && sessionId !== activeSession?.id) {
      selectSession(sessionId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  return <ChatView session={session} onSend={sendMessage} />;
}

/** Маршрут сторінки плагіна: route з ui:routes за /plugin/:routeId. */
function PluginRouteView({ routes }: { routes: PluginRoute[] }): React.ReactNode {
  const { routeId } = useParams();
  const route = routes.find((r) => r.id === routeId);
  if (!route) {
    return <div className="p-4 text-muted">Сторінку не знайдено.</div>;
  }
  return route.render();
}
