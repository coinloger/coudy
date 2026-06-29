import { useState, useSyncExternalStore } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  Box,
  Boxes,
  FileText,
  LayoutDashboard,
  LayoutGrid,
  MessageSquare,
  Package,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Puzzle,
  Search,
  Settings as SettingsIcon,
  Star,
  Trash2,
  Zap,
  type LucideIcon,
} from "lucide-react";
import type { SidebarItem } from "./types";
import type { ChatSession } from "./sessions";
import { sessionRunner } from "./session-runner";

interface SidebarProps {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  sessions: ChatSession[];
  sidebarItems: SidebarItem[];
  onSelectSession: (id: string) => void;
  onCreateSession: () => void;
  onDeleteSession: (id: string) => void;
}

/** Curated-карта іконок Lucide за іменем (для пунктів від плагінів). */
const ICON_MAP: Record<string, LucideIcon> = {
  LayoutGrid,
  LayoutDashboard,
  Boxes,
  Box,
  Package,
  Puzzle,
  FileText,
  Star,
  MessageSquare,
  Settings: SettingsIcon,
};

function resolveIcon(name?: string): LucideIcon {
  if (name && ICON_MAP[name]) return ICON_MAP[name];
  return LayoutGrid;
}

/** Set сталого посилання на порожній список (для useSyncExternalStore). */
const EMPTY: string[] = [];

/** Сесії, що зараз стрімляться (для пульсуючого індикатора в Sidebar). */
function useRunningSessions(): string[] {
  // runningIds() повертає стабільний кешований масив (те саме посилання між змінами),
  // тож useSyncExternalStore не циклиться.
  return useSyncExternalStore(
    (cb) => sessionRunner.subscribeAll(cb),
    () => sessionRunner.runningIds(),
    () => EMPTY,
  );
}

/** Вбудовані пункти футера (Дашборд/Плагіни/Налаштування) — шляхи маршрутизації. */
const BUILTIN_FOOTER: {
  id: string;
  label: string;
  icon: LucideIcon;
  path: string;
  /** чи вважати цей пункт активним за шляхом */
  match: (pathname: string) => boolean;
}[] = [
  {
    id: "dashboard",
    label: "Дашборд",
    icon: LayoutDashboard,
    path: "/dashboard",
    match: (p) => p === "/" || p === "/dashboard",
  },
  { id: "plugins", label: "Плагіни", icon: Puzzle, path: "/plugins", match: (p) => p === "/plugins" },
  { id: "library", label: "Бібліотека", icon: Boxes, path: "/library", match: (p) => p === "/library" },
  { id: "settings", label: "Налаштування", icon: SettingsIcon, path: "/settings", match: (p) => p === "/settings" },
];

function ItemButton(props: {
  active: boolean;
  collapsed: boolean;
  title: string;
  icon: React.ReactNode;
  label?: string;
  trailing?: React.ReactNode;
  onClick: () => void;
}): React.ReactNode {
  const { active, collapsed, title, icon, label, trailing, onClick } = props;
  return (
    <div
      className={`d-flex align-items-center gap-2 rounded px-2 py-1 ${
        collapsed ? "justify-content-center" : ""
      } ${active ? "bg-primary text-white" : "text-light"}`}
      style={{ cursor: "pointer", minWidth: 0 }}
      role="button"
      title={title}
      onClick={onClick}
    >
      <span className="flex-shrink-0 d-flex align-items-center">{icon}</span>
      {!collapsed && label && (
        <span className="small text-truncate flex-grow-1" style={{ minWidth: 0 }}>
          {label}
        </span>
      )}
      {!collapsed && trailing}
    </div>
  );
}

export default function Sidebar(props: SidebarProps): React.ReactNode {
  const {
    collapsed,
    onToggleCollapsed,
    sessions,
    sidebarItems,
    onSelectSession,
    onCreateSession,
    onDeleteSession,
  } = props;

  const navigate = useNavigate();
  const location = useLocation();
  const [query, setQuery] = useState("");
  const running = useRunningSessions();

  const filteredSessions = query.trim()
    ? sessions.filter((s) => s.title.toLowerCase().includes(query.trim().toLowerCase()))
    : sessions;

  const width = collapsed ? 60 : 280;

  const isSessionActive = (id: string): boolean => location.pathname === `/chat/${id}`;
  const isPluginActive = (routeId?: string): boolean =>
    !!routeId && location.pathname === `/plugin/${routeId}`;

  /** Видалити сесію; якщо це поточний активний чат — редирект на дашборд. */
  const handleDeleteSession = (id: string): void => {
    const wasActive = isSessionActive(id);
    void onDeleteSession(id);
    if (wasActive) navigate("/");
  };

  return (
    <aside
      className="coudy-sidebar d-flex flex-column bg-dark text-light border-end"
      style={{ width, minWidth: width, transition: "width 0.15s ease" }}
    >
      {/* Блок лого */}
      <div className="d-flex align-items-center gap-2 px-2 py-2">
        <button
          type="button"
          className="btn btn-sm btn-dark text-light px-1"
          title={collapsed ? "Розгорнути" : "Згорнути"}
          onClick={onToggleCollapsed}
        >
          {collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
        </button>
        {!collapsed && (
          <button
            type="button"
            className="btn btn-link text-light text-decoration-none d-flex align-items-center gap-1 p-0 flex-grow-1"
            title="На дашборд"
            onClick={() => navigate("/dashboard")}
          >
            <Zap size={18} className="text-warning" />
            <span className="fw-semibold">coudycode</span>
          </button>
        )}
        {!collapsed && (
          <button
            type="button"
            className="btn btn-sm btn-dark text-light px-1"
            title="Новий чат"
            onClick={onCreateSession}
          >
            <Plus size={18} />
          </button>
        )}
      </div>

      {/* Кнопка нового чату у згорнутому стані */}
      {collapsed && (
        <div className="d-flex justify-content-center pb-2">
          <button
            type="button"
            className="btn btn-sm btn-dark text-light"
            title="Новий чат"
            onClick={onCreateSession}
          >
            <Plus size={18} />
          </button>
        </div>
      )}

      {/* Пошук сесій */}
      {!collapsed && (
        <div className="px-2 pb-2">
          <div className="input-group input-group-sm">
            <span className="input-group-text bg-dark text-light border-secondary">
              <Search size={14} />
            </span>
            <input
              type="text"
              className="form-control form-control-sm bg-dark text-light border-secondary"
              placeholder="Пошук сесій"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        </div>
      )}

      {/* Сесії */}
      <div className="flex-grow-1 overflow-auto px-1">
        {!collapsed && (
          <div className="text-uppercase text-secondary small px-2 py-1">Нещодавні</div>
        )}
        <ul className="nav flex-column gap-1 mb-2">
          {filteredSessions.map((s) => (
            <li className="nav-item" key={s.id}>
              <ItemButton
                active={isSessionActive(s.id)}
                collapsed={collapsed}
                title={s.title}
                icon={<MessageSquare size={16} />}
                label={s.title}
                onClick={() => onSelectSession(s.id)}
                trailing={
                  <>
                    {running.includes(s.id) && (
                      <span className="cc-sidebar-running-dot" title="Працює у фоні" />
                    )}
                    <button
                      type="button"
                      className="btn btn-sm btn-link text-secondary p-0 flex-shrink-0"
                      title="Видалити"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteSession(s.id);
                      }}
                    >
                      <Trash2 size={14} />
                    </button>
                  </>
                }
              />
            </li>
          ))}
          {!collapsed && filteredSessions.length === 0 && (
            <li className="px-2 text-secondary small">Немає сесій</li>
          )}
        </ul>
      </div>

      {/* Футер сайдбару: пункти плагінів (ui:sidebar-items) над системними пунктами */}
      <div className="border-top border-secondary px-1 py-2">
        {sidebarItems.length > 0 && (
          <ul className="nav flex-column gap-1 mb-2">
            {sidebarItems.map((item) => {
              const ItemIcon = resolveIcon(item.icon);
              return (
                <li className="nav-item" key={item.id}>
                  <ItemButton
                    active={isPluginActive(item.routeId)}
                    collapsed={collapsed}
                    title={item.label}
                    icon={<ItemIcon size={16} />}
                    label={item.label}
                    onClick={() =>
                      item.routeId && navigate(`/plugin/${item.routeId}`)
                    }
                  />
                </li>
              );
            })}
          </ul>
        )}
        {sidebarItems.length > 0 && !collapsed && (
          <div className="border-top border-secondary my-2" />
        )}
        <ul className="nav flex-column gap-1">
          {BUILTIN_FOOTER.map((f) => (
            <li className="nav-item" key={f.id}>
              <ItemButton
                active={f.match(location.pathname)}
                collapsed={collapsed}
                title={f.label}
                icon={<f.icon size={16} />}
                label={f.label}
                onClick={() => navigate(f.path)}
              />
            </li>
          ))}
        </ul>
      </div>
    </aside>
  );
}
