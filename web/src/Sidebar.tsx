import { useState, useSyncExternalStore } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  Box,
  Boxes,
  ChevronDown,
  ChevronRight,
  FileText,
  FolderClosed,
  LayoutDashboard,
  LayoutGrid,
  MessageSquare,
  MessageSquarePlus,
  NotebookPen,
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
import { useProjects } from "./projects";
import { MemoryPanel } from "./MemoryPanel";
import { Modal } from "./Modal";
import { toastStore } from "./Toast";

interface SidebarProps {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  sessions: ChatSession[];
  sidebarItems: SidebarItem[];
  onSelectSession: (id: string) => void;
  onCreateSession: () => void;
  onDeleteSession: (id: string) => void;
  /** Створити сесію всередині проєкту (з projectId). Повертає id нової сесії. */
  onCreateProjectSession: (projectId: string) => Promise<string>;
  /** Оновити список сесій (після видалення проєкту — loose-сесії зʼявляться). */
  refreshSessions: () => Promise<void>;
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
      className={`d-flex align-items-center gap-2 rounded px-2 py-1 w-100 overflow-hidden ${
        collapsed ? "justify-content-center" : ""
      } ${active ? "bg-primary text-white" : "text-light"}`}
      style={{ cursor: "pointer", minWidth: 0 }}
      role="button"
      title={title}
      onClick={onClick}
    >
      <span className="flex-shrink-0 d-flex align-items-center">{icon}</span>
      {!collapsed && label && (
        <span className="small text-truncate" style={{ minWidth: 0, flex: "1 1 0%" }}>
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
    onCreateProjectSession,
    refreshSessions,
  } = props;

  const navigate = useNavigate();
  const location = useLocation();
  const [query, setQuery] = useState("");
  const running = useRunningSessions();
  const { projects, create: createProject, remove: removeProject } = useProjects();

  // Розкриті проєкти (за id) + модалки.
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [memoryProject, setMemoryProject] = useState<{ id: string; name: string } | null>(null);
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");

  const q = query.trim().toLowerCase();
  const match = (title: string): boolean => !q || title.toLowerCase().includes(q);

  // Loose-чати (без проєкту) — «Нещодавні». Сесії проєктів групуються клієнтськи.
  const looseSessions = sessions.filter((s) => !s.projectId && match(s.title));

  const toggleExpanded = (id: string): void => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

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

  /** Створити чат у проєкті → розкрити проєкт + перейти в новий чат. */
  const handleCreateProjectSession = async (projectId: string): Promise<void> => {
    const id = await onCreateProjectSession(projectId);
    setExpanded((prev) => new Set(prev).add(projectId));
    navigate(`/chat/${id}`);
  };

  /** Створити проєкт через модалку. */
  const handleCreateProject = async (): Promise<void> => {
    const name = newProjectName.trim();
    if (!name) return;
    const p = await createProject(name);
    setNewProjectOpen(false);
    setNewProjectName("");
    if (p) {
      setExpanded((prev) => new Set(prev).add(p.id));
    } else {
      toastStore.push({ title: "Не вдалося створити проєкт" });
    }
  };

  /** Видалити проєкт (сесії стають loose). Оновити сесії, щоб projectId скинувся. */
  const handleDeleteProject = async (projectId: string): Promise<void> => {
    const ok = await removeProject(projectId);
    if (ok) {
      setExpanded((prev) => {
        const next = new Set(prev);
        next.delete(projectId);
        return next;
      });
      // Сесії проєкту стали loose — оновити список, щоб зʼявились у «Нещодавні».
      void refreshSessions();
    } else {
      toastStore.push({ title: "Не вдалося видалити проєкт" });
    }
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

      {/* Проєкти + Нещодавні */}
      <div className="flex-grow-1 overflow-y-auto overflow-x-hidden px-1" style={{ minWidth: 0 }}>
        {!collapsed && (
          <>
            {/* Секція «Проєкти» */}
            <div className="d-flex align-items-center justify-content-between px-2 py-1">
              <span className="text-uppercase text-secondary small">Проєкти</span>
              <button
                type="button"
                className="btn btn-sm btn-link text-secondary p-0"
                title="Новий проєкт"
                onClick={() => setNewProjectOpen(true)}
              >
                <Plus size={14} />
              </button>
            </div>
            <ul className="nav flex-column gap-1 mb-2">
              {projects.map((p) => {
                const isOpen = expanded.has(p.id);
                const projSessions = sessions.filter((s) => s.projectId === p.id && match(s.title));
                // При пошуку — авто-розкрити проєкти з матчами.
                const showSessions = isOpen || (!!q && projSessions.length > 0);
                return (
                  <li className="nav-item w-100 overflow-hidden" key={p.id} style={{ minWidth: 0 }}>
                    <div
                      className={`cc-project-row d-flex align-items-center gap-1 rounded px-2 py-1 w-100 ${
                        isOpen ? "bg-secondary-subtle text-light" : "text-light"
                      }`}
                      style={{ cursor: "pointer", minWidth: 0 }}
                      role="button"
                      title={p.name}
                      onClick={() => toggleExpanded(p.id)}
                    >
                      <span className="flex-shrink-0 text-secondary">
                        {showSessions ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      </span>
                      <span className="flex-shrink-0 d-flex align-items-center">
                        <FolderClosed size={15} />
                      </span>
                      <span className="small text-truncate flex-grow-1" style={{ minWidth: 0 }}>
                        {p.name}
                      </span>
                      <button
                        type="button"
                        className="btn btn-sm btn-link text-secondary p-0 flex-shrink-0"
                        title="Памʼять проєкту"
                        onClick={(e) => {
                          e.stopPropagation();
                          setMemoryProject({ id: p.id, name: p.name });
                        }}
                      >
                        <NotebookPen size={14} />
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm btn-link text-secondary p-0 flex-shrink-0"
                        title="Видалити проєкт (сесії лишаться)"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (confirm(`Видалити проєкт «${p.name}»? Сесії стануть loose і лишаться в «Нещодавні».`)) {
                            void handleDeleteProject(p.id);
                          }
                        }}
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                    {showSessions && (
                      <ul className="cc-project-sessions nav flex-column gap-1 mt-1 ms-2 mb-1">
                        {projSessions.map((s) => (
                          <li className="nav-item w-100 overflow-hidden" key={s.id} style={{ minWidth: 0 }}>
                            <ItemButton
                              active={isSessionActive(s.id)}
                              collapsed={collapsed}
                              title={s.title}
                              icon={<MessageSquare size={15} />}
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
                                    <Trash2 size={13} />
                                  </button>
                                </>
                              }
                            />
                          </li>
                        ))}
                        <li className="nav-item w-100">
                          <button
                            type="button"
                            className="btn btn-sm btn-link text-secondary p-0 d-flex align-items-center gap-1"
                            title="Новий чат у проєкті"
                            onClick={() => void handleCreateProjectSession(p.id)}
                          >
                            <MessageSquarePlus size={14} />
                            <span className="small">Новий чат</span>
                          </button>
                        </li>
                      </ul>
                    )}
                  </li>
                );
              })}
              {projects.length === 0 && (
                <li className="px-2 text-secondary small">Немає проєктів</li>
              )}
            </ul>

            {/* Секція «Нещодавні» */}
            <div className="text-uppercase text-secondary small px-2 py-1">Нещодавні</div>
          </>
        )}
        <ul className="nav flex-column gap-1 mb-2">
          {looseSessions.map((s) => (
            <li className="nav-item w-100 overflow-hidden" key={s.id} style={{ minWidth: 0 }}>
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
          {!collapsed && looseSessions.length === 0 && (
            <li className="px-2 text-secondary small">Немає чатів</li>
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
                <li className="nav-item w-100 overflow-hidden" key={item.id} style={{ minWidth: 0 }}>
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
            <li className="nav-item w-100 overflow-hidden" key={f.id} style={{ minWidth: 0 }}>
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

      {/* Модалка нового проєкту. */}
      <Modal
        open={newProjectOpen}
        title="Новий проєкт"
        onClose={() => {
          setNewProjectOpen(false);
          setNewProjectName("");
        }}
        footer={
          <>
            <button
              type="button"
              className="btn btn-sm btn-secondary"
              onClick={() => {
                setNewProjectOpen(false);
                setNewProjectName("");
              }}
            >
              Скасувати
            </button>
            <button
              type="button"
              className="btn btn-sm btn-primary"
              disabled={!newProjectName.trim()}
              onClick={() => void handleCreateProject()}
            >
              Створити
            </button>
          </>
        }
      >
        <label className="form-label small">Назва проєкту</label>
        <input
          type="text"
          className="form-control"
          placeholder="Напр. coudycode, маркетинг-сайт…"
          value={newProjectName}
          autoFocus
          onChange={(e) => setNewProjectName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void handleCreateProject();
          }}
        />
      </Modal>

      {/* Панель памʼяті проєкту. */}
      <MemoryPanel
        open={memoryProject !== null}
        project={memoryProject}
        onClose={() => setMemoryProject(null)}
      />
    </aside>
  );
}
