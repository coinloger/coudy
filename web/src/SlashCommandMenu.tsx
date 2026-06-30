import { useEffect, useMemo, useRef } from "react";
import type { SlashCommand } from "./slash-commands";

export interface SlashCommandMenuProps {
	/** Поточне значення textarea. */
	input: string;
	/** Реєстр доступних команд. */
	commands: SlashCommand[];
	/** Індекс активного (підсвіченого) елемента. */
	active: number;
	/** Вставити команду: трансформує textarea у `/name `. */
	onSelect: (name: string) => void;
}

/**
 * Відфільтрувати+відсортувати команди за префіксом (subsequence fuzzy).
 * Експортовано, щоб батько міг знати кількість для навігації зі стрілками.
 */
export function filterSlashCommands(prefix: string, commands: SlashCommand[]): SlashCommand[] {
	const scored = commands
		.map((c) => ({ c, s: fuzzyScore(prefix, c.name, c.description) }))
		.filter((x) => x.s >= 0);
	scored.sort((a, b) => b.s - a.s);
	return scored.map((x) => x.c);
}

/**
 * Menю автодоповнення slash-команд під textarea (pi TUI-стайл).
 * Показується лише коли input = "/…" без пробілу (юзер ще набирає імʼя).
 * fuzzyScore дублюється локально (subsequence-пошук по name+description).
 * Навігація клавіатурою (↑↓/Enter/Esc) обробляється у батька (ChatView),
 * тут лише рендер + клік/наведення мишею.
 */
function fuzzyScore(query: string, label: string, desc: string): number {
	if (!query) return 1;
	const hay = (label + " " + desc).toLowerCase();
	const q = query.toLowerCase();
	const idx = hay.indexOf(q);
	if (idx !== -1) return 1000 - idx;
	let qi = 0;
	for (let hi = 0; hi < hay.length && qi < q.length; hi++) {
		if (hay[hi] === q[qi]) qi++;
	}
	return qi === q.length ? 100 - q.length : -1;
}

export function SlashCommandMenu({
	input,
	commands,
	active,
	onSelect,
}: SlashCommandMenuProps): React.ReactNode {
	const listRef = useRef<HTMLDivElement>(null);

	const prefix = useMemo(() => {
		// Важливо: перевіряти пробіл у СИРОМУ input (не обрізаному) — інакше
		// "/compact " (з trailing-пробілом після вставки) лишиться «без пробілу» після trim.
		const t = input.trim();
		return t.startsWith("/") && !input.includes(" ") ? t.slice(1) : null;
	}, [input]);

	const filtered = useMemo(
		() => (prefix === null ? [] : filterSlashCommands(prefix, commands)),
		[commands, prefix],
	);

	// Прокрутити активний елемент у видиму зону.
	useEffect(() => {
		const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`);
		el?.scrollIntoView({ block: "nearest" });
	}, [active]);

	if (prefix === null || filtered.length === 0) return null;

	return (
		<div className="cc-slash-menu" ref={listRef} role="listbox" aria-label="Slash-команди">
			{filtered.map((c, idx) => (
				<button
					key={c.name}
					type="button"
					data-idx={idx}
					className={`cc-slash-item ${idx === active ? "is-active" : ""}`}
					onMouseEnter={() => {
						// Підсвічування мишею через спільний стан батька неможливе без колбеку;
						// наведення оновлює лише CSS :hover, а Enter використовує active з клавіатури.
					}}
					onClick={() => onSelect(c.name)}
				>
					<span className="cc-slash-item-name">/{c.name}</span>
					<span className="cc-slash-item-desc">{c.description}</span>
				</button>
			))}
		</div>
	);
}

/**
 * Чи відкрите меню зараз (input = "/…" без пробілу).
 * Експортовано, щоб батько міг знати про стан для обробки клавіатури.
 */
export function isSlashMenuOpen(input: string): boolean {
	const t = input.trim();
	return t.startsWith("/") && !input.includes(" ");
}
