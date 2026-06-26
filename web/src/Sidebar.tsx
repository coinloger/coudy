import { useState } from "react";
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

export type ViewId = "dashboard" | "plugins" | "settings";

export type View =
  | { kind: "chat" }
  | { kind: "view"; id: ViewId }
  | { kind: "route"; id: string };

interface SidebarProps {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  sessions: ChatSession[];
  activeSessionId: string | null;
  sidebarItems: SidebarItem[];
  view: View;
  onSelectSession: (id: string) => void;
  onCreateSession: () => void;
  onDeleteSession: (id: string) => void;
  onSelectView: (view: View) => void;
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
  Settings: SettingsIcon,
};

function resolveIcon(name?: string): LucideIcon {
  if (name && ICON_MAP[name]) return ICON_MAP[name];
  return LayoutGrid;
}

/** Вбудовані пункти футера (Дашборд/Плагіни/Налаштування). */
const BUILTIN_FOOTER: { id: string; label: string; icon: LucideIcon; view: View }[] = [
  { id: "dashboard", label: "Дашборд", icon: LayoutDashboard, view: { kind: "view", id: "dashboard" } },
  { id: "plugins", label: "Плагіни", icon: Puzzle, view: { kind: "view", id: "plugins" } },
  { id: "settings", label: "Налаштування", icon: SettingsIcon, view: { kind: "view", id: "settings" } },
];

function isViewEqual(a: View, b: View): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "chat" && b.kind === "chat") return true;
  if (a.kind === "view" && b.kind === "view") return a.id === b.id;
  if (a.kind === "route" && b.kind === "route") return a.id === b.id;
  return false;
}

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
      style={{ cursor: "pointer" }}
      role="button"
      title={title}
      onClick={onClick}
    >
      <span className="flex-shrink-0 d-flex align-items-center">{icon}</span>
      {!collapsed && label && <span className="small text-truncate flex-grow-1">{label}</span>}
      {!collapsed && trailing}
    </div>
  );
}

export default function Sidebar(props: SidebarProps): React.ReactNode {
  const {
    collapsed,
    onToggleCollapsed,
    sessions,
    activeSessionId,
    sidebarItems,
    view,
    onSelectSession,
    onCreateSession,
    onDeleteSession,
    onSelectView,
  } = props;

  const [query, setQuery] = useState("");

  const filteredSessions = query.trim()
    ? sessions.filter((s) => s.title.toLowerCase().includes(query.trim().toLowerCase()))
    : sessions;

  const width = collapsed ? 60 : 280;

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
            onClick={() => onSelectView({ kind: "view", id: "dashboard" })}
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
          {filteredSessions.map((s) => {
            const active = activeSessionId === s.id && view.kind === "chat";
            return (
              <li className="nav-item" key={s.id}>
                <ItemButton
                  active={active}
                  collapsed={collapsed}
                  title={s.title}
                  icon={<MessageSquare size={16} />}
                  label={s.title}
                  onClick={() => onSelectSession(s.id)}
                  trailing={
                    <button
                      type="button"
                      className="btn btn-sm btn-link text-secondary p-0 flex-shrink-0"
                      title="Видалити"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteSession(s.id);
                      }}
                    >
                      <Trash2 size={14} />
                    </button>
                  }
                />
              </li>
            );
          })}
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
              const active = view.kind === "route" && view.id === item.routeId;
              return (
                <li className="nav-item" key={item.id}>
                  <ItemButton
                    active={!!active}
                    collapsed={collapsed}
                    title={item.label}
                    icon={<ItemIcon size={16} />}
                    label={item.label}
                    onClick={() =>
                      item.routeId &&
                      onSelectView({ kind: "route", id: item.routeId })
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
                active={isViewEqual(view, f.view)}
                collapsed={collapsed}
                title={f.label}
                icon={<f.icon size={16} />}
                label={f.label}
                onClick={() => onSelectView(f.view)}
              />
            </li>
          ))}
        </ul>
      </div>
    </aside>
  );
}
