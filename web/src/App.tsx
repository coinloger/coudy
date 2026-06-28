import { useEffect, useMemo, useState } from "react";
import { Navigate, Route, Routes, useNavigate, useParams } from "react-router-dom";
import Sidebar from "./Sidebar";
import Dashboard from "./Dashboard";
import PluginManager from "./PluginManager";
import ChatView from "./ChatView";
import Settings from "./Settings";
import Playground from "./playground/Playground";
import CommandPalette from "./CommandPalette";
import { useCoudyUI } from "./useCoudyUI";
import { useSessions } from "./sessions";
import type {
  ChatPanel,
  Command,
  DashboardWidget,
  MessageAction,
  Route as PluginRoute,
  SettingsTab,
  SidebarItem,
} from "./types";

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
const defaultSettingsTabs: SettingsTab[] = [];
const defaultChatPanels: ChatPanel[] = [];
const defaultMessageActions: MessageAction[] = [];
const defaultCommands: Command[] = [];

export default function App(): React.ReactNode {
  const [collapsed, setCollapsed] = useState<boolean>(() => loadCollapsed());
  const navigate = useNavigate();

  const sessions = useSessions();
  const ui = useCoudyUI({
    sidebarItems: defaultSidebarItems,
    dashboardWidgets: defaultDashboardWidgets,
    routes: defaultRoutes,
    settingsTabs: defaultSettingsTabs,
    chatPanels: defaultChatPanels,
    messageActions: defaultMessageActions,
    commands: defaultCommands,
  });

  const [paletteOpen, setPaletteOpen] = useState(false);

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

  /** Стиснути контекст поточної сесії (POST /api/sessions/:id/compact SSE). */
  const handleCompact = async (): Promise<void> => {
    const id = sessions.activeId;
    if (!id) return;
    try {
      const res = await fetch(`/api/sessions/${encodeURIComponent(id)}/compact`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (res.ok) await sessions.refresh();
    } catch (e) {
      console.error("[palette] compact помилка:", e);
    }
  };

  // Базові (вбудовані) команди — плагіни розширюють через ui:command-palette.
  const coreCommands = useMemo<Command[]>(
    () => [
      {
        id: "core:new-chat",
        label: "Новий чат",
        icon: "MessageSquarePlus",
        keywords: "new chat session create створити",
        group: "Дії",
        action: () => void handleCreateSession(),
      },
      ...(sessions.activeId
        ? [
            {
              id: "core:compact",
              label: "Стиснути контекст",
              icon: "Archive",
              keywords: "compact summarize summarize стиснути контекст",
              group: "Дії",
              action: () => void handleCompact(),
            } satisfies Command,
          ]
        : []),
      {
        id: "core:dashboard",
        label: "Дашборд",
        icon: "LayoutDashboard",
        keywords: "home dashboard головна",
        group: "Навігація",
        action: () => navigate("/dashboard"),
      },
      {
        id: "core:plugins",
        label: "Плагіни",
        icon: "Puzzle",
        keywords: "plugins extensions extensions",
        group: "Навігація",
        action: () => navigate("/plugins"),
      },
      {
        id: "core:settings",
        label: "Налаштування",
        icon: "Settings",
        keywords: "settings preferences налаштування",
        group: "Навігація",
        action: () => navigate("/settings"),
      },
      ...sessions.sessions.slice(0, 5).map((s, i) => ({
        id: `core:session:${s.id}`,
        label: s.title || `Чат ${i + 1}`,
        icon: "MessageSquare",
        keywords: "chat session чат",
        group: "Нещодавні",
        action: () => handleSelectSession(s.id),
      })),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sessions.activeId, sessions.sessions],
  );

  // Команди палітри: агреговані (core + плагіни з ui:command-palette) + core (жирні).
  const paletteCommands = useMemo<Command[]>(() => {
    const seen = new Set(coreCommands.map((c) => c.id));
    const merged: Command[] = [...coreCommands];
    for (const c of ui.commands) {
      if (!seen.has(c.id)) {
        seen.add(c.id);
        merged.push(c);
      }
    }
    return merged;
  }, [coreCommands, ui.commands]);

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
          <Route path="/settings" element={<Settings tabs={ui.settingsTabs} />} />
          <Route path="/playground" element={<Playground />} />
          <Route
            path="/chat/:sessionId"
            element={<ChatRoute chatPanels={ui.chatPanels} messageActions={ui.messageActions} />}
          />
          <Route
            path="/plugin/:routeId"
            element={<PluginRouteView routes={ui.routes} />}
          />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </main>

      {/* Командна палітра (⌘K / Ctrl+K) — глобальна, поза роутами. */}
      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        commands={paletteCommands}
      />
    </div>
  );
}

/** Маршрут чату: сесія за /chat/:sessionId з URL. ChatView самостійний (завантажує історію + SSE). */
function ChatRoute({
  chatPanels,
  messageActions,
}: {
  chatPanels: ChatPanel[];
  messageActions: MessageAction[];
}): React.ReactNode {
  const { sessionId } = useParams();
  if (!sessionId) {
    return <div className="p-4 text-muted">Сесію не обрано.</div>;
  }
  return (
    <ChatView sessionId={sessionId} chatPanels={chatPanels} messageActions={messageActions} />
  );
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
