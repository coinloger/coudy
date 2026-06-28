import { useEffect, useMemo, useRef, useState } from "react";
import {
  LayoutDashboard,
  Puzzle,
  Settings as SettingsIcon,
  MessageSquarePlus,
  Sparkles,
  Archive,
  MessageSquare,
  CornerDownLeft,
  Search,
  type LucideIcon,
} from "lucide-react";
import type { Command } from "./types";

/** Карта іконок Lucide за іменем (для команд core + плагінів). */
const ICON_MAP: Record<string, LucideIcon> = {
  LayoutDashboard,
  Puzzle,
  Settings: SettingsIcon,
  MessageSquarePlus,
  Sparkles,
  Archive,
  MessageSquare,
};

function resolveIcon(name?: string): LucideIcon {
  if (name && ICON_MAP[name]) return ICON_MAP[name];
  return Sparkles;
}

export interface CommandPaletteProps {
  /** Чи відкрита палітра. */
  open: boolean;
  /** Закрити (з зовні / Esc / вибір). */
  onOpenChange: (open: boolean) => void;
  /** Агреговані команди (core + плагіни). */
  commands: Command[];
}

/**
 * Префікс: чи входить query у label/keywords (case-insensitive). Порожній
 * query → усі команди. Використовується для мінімального fuzzy-пошуку:
 * літери query мають зʾявитись поспіль у тому ж порядку.
 */
function fuzzyScore(query: string, label: string, keywords = ""): number {
  if (!query) return 1;
  const hay = (label + " " + keywords).toLowerCase();
  const q = query.toLowerCase();

  // Підрядковий збіг — найвищий пріоритет.
  const idx = hay.indexOf(q);
  if (idx !== -1) return 1000 - idx;

  // Subsequence (fuzzy): літери по порядку.
  let qi = 0;
  for (let hi = 0; hi < hay.length && qi < q.length; hi++) {
    if (hay[hi] === q[qi]) qi++;
  }
  return qi === q.length ? 100 - q.length : -1;
}

export default function CommandPalette({ open, onOpenChange, commands }: CommandPaletteProps): React.ReactNode {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Глобальний keydown: ⌘K / Ctrl+K → toggle. Esc (коли відкрито) → закрити.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        onOpenChange(!open);
        return;
      }
      if (e.key === "Escape" && open) {
        e.preventDefault();
        onOpenChange(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onOpenChange]);

  // Скинути стан при відкритті; фокус на інпут.
  useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
      // autofocus у наступному тіку після рендеру модалки.
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  // Відфільтрувати + відсортувати команди по fuzzy-оцінці.
  const filtered = useMemo(() => {
    const scored = commands
      .map((c) => ({ c, s: fuzzyScore(query, c.label, c.keywords) }))
      .filter((x) => x.s >= 0);
    scored.sort((a, b) => b.s - a.s);
    return scored.map((x) => x.c);
  }, [commands, query]);

  // Коригувати active, якщо виходить за межі відфільтрованого списку.
  useEffect(() => {
    if (active >= filtered.length) setActive(0);
  }, [filtered.length, active]);

  // Прокрутити активний елемент у видиму зону.
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [active]);

  // Групування по group з глобальним індексом (для клавіатури).
  const grouped = useMemo(() => {
    let globalIdx = 0;
    const order: string[] = [];
    const map = new Map<string, { cmd: Command; idx: number }[]>();
    for (const c of filtered) {
      const g = c.group ?? "";
      if (!map.has(g)) {
        map.set(g, []);
        order.push(g);
      }
      map.get(g)!.push({ cmd: c, idx: globalIdx++ });
    }
    return order.map((g) => ({ group: g, items: map.get(g)! }));
  }, [filtered]);

  // Early return — ПІСЛЯ всіх хуків (Rules of Hooks: умовний return не може бути
  // перед useMemo/useEffect, інакше React крашить «Rendered more hooks»).
  if (!open) return null;

  // Виконати команду і закрити.
  const run = (cmd: Command | undefined): void => {
    if (!cmd) return;
    onOpenChange(false);
    try {
      cmd.action();
    } catch (e) {
      console.error("[palette] помилка команди:", cmd.id, e);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      run(filtered[active]);
    }
  };

  return (
    <div
      className="cc-palette-overlay"
      onClick={() => onOpenChange(false)}
      role="dialog"
      aria-modal="true"
      aria-label="Командна палітра"
    >
      <div className="cc-palette" onClick={(e) => e.stopPropagation()}>
        <div className="cc-palette-input-wrap">
          <Search size={16} className="cc-palette-search-icon" />
          <input
            ref={inputRef}
            type="text"
            className="cc-palette-input"
            placeholder="Пошук команд…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
          />
          <kbd className="cc-palette-esc">esc</kbd>
        </div>

        {filtered.length === 0 ? (
          <div className="cc-palette-empty">Нічого не знайдено</div>
        ) : (
          <div className="cc-palette-list" ref={listRef}>
            {grouped.map(({ group, items }) => (
              <div key={group || "default"} className="cc-palette-group">
                {group && <div className="cc-palette-group-title">{group}</div>}
                {items.map(({ cmd: c, idx }) => {
                  const Icon = resolveIcon(c.icon);
                  return (
                    <button
                      key={c.id}
                      type="button"
                      data-idx={idx}
                      className={`cc-palette-item ${idx === active ? "is-active" : ""}`}
                      onMouseEnter={() => setActive(idx)}
                      onClick={() => run(c)}
                    >
                      <span className="cc-palette-item-icon">
                        <Icon size={16} />
                      </span>
                      <span className="cc-palette-item-label">{c.label}</span>
                      {idx === active && (
                        <span className="cc-palette-item-hint">
                          <CornerDownLeft size={13} />
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
