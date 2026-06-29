import type { AgentMessage } from "@coudycode/agent-core";
import { Copy, RotateCcw, RefreshCw, Clipboard, Trash2, Pencil, Clock, type LucideIcon } from "lucide-react";

/** Мапа назв-іконок (з MessageAction.icon) → компонент Lucide. */
const ICONS: Record<string, LucideIcon> = {
	copy: Copy,
	clipboard: Clipboard,
	retry: RotateCcw,
	refresh: RefreshCw,
	rotate: RotateCcw,
	edit: Pencil,
	trash: Trash2,
	delete: Trash2,
	time: Clock,
	clock: Clock,
};

/** Лейбл дії: сталий рядок або функція від повідомлення (напр. час). */
export type MessageActionLabel = string | ((message: AgentMessage) => string);

/**
 * Дія на повідомленні (hover), додана плагіном через ui:message-actions
 * або built-in (copy/time/retry).
 *
 * Режими:
 *  - клікабельна кнопка: задай `onClick`.
 *  - readonly-текст (напр. час «HH:MM»): `display: true` БЕЗ onClick.
 *
 * `label` може бути функцією від повідомлення (час, копіювання-фідбек).
 * `show` фільтрує дію per-message (напр. retry лише для user).
 */
export interface MessageAction {
	id: string;
	label: MessageActionLabel;
	/** Назва іконки Lucide (опц., ігнорується в headless UI). */
	icon?: string;
	/** Обробник кліку. Якщо відсутній + display — рендериться як readonly-текст. */
	onClick?: (message: AgentMessage) => void;
	/**
	 * Readonly-режим (текст без кліку, напр. час).
	 * При `display:true` без onClick — рендериться як спан.
	 */
	display?: boolean;
	/** Per-message фільтр видимості (true = показати). */
	show?: (message: AgentMessage) => boolean;
}

export interface MessageActionsBarProps {
	/** Повідомлення, до якого привʼязані дії. */
	message: AgentMessage;
	/** Дії (вбудовані + від плагінів). */
	actions: MessageAction[];
}

/** Обчислити label (сталий рядок або функція). */
function resolveLabel(label: MessageActionLabel, message: AgentMessage): string {
	return typeof label === "function" ? label(message) : label;
}

/** Іконка дії за назвою (lowercase); undefined якщо не задано/невідомо. */
function resolveIcon(name?: string): LucideIcon | undefined {
	if (!name) return undefined;
	return ICONS[name.toLowerCase()];
}

/**
 * Рядок дій при hover на повідомленнях (ChatGPT-стайл).
 * Рендериться в обгортці повідомлення; показується через CSS :hover батька.
 */
export function MessageActionsBar({ message, actions }: MessageActionsBarProps): React.ReactNode {
	// Фільтрувати за show() + пропустити приховані.
	const visible = actions.filter((a) => !a.show || a.show(message));
	if (visible.length === 0) return null;
	return (
		<div className="cc-ui-msg-actions">
			{visible.map((action) => {
				const label = resolveLabel(action.label, message);
				const Icon = resolveIcon(action.icon);
				// readonly-текст (напр. час) — текст + опц. іконка годинника, без кліку.
				if (action.display && !action.onClick) {
					return (
						<span
							key={action.id}
							className="cc-ui-msg-action cc-ui-msg-action-readonly"
							title={label}
						>
							{Icon ? <Icon size={12} className="cc-ui-msg-action-icon" /> : null}
							{label}
						</span>
					);
				}
				// Клікабельна дія — лише іконка з тултіпом (label у title + aria-label);
				// якщо іконки нема (напр. плагін без icon) — рендерити текст label.
				return (
					<button
						key={action.id}
						type="button"
						className={`cc-ui-msg-action${Icon ? " cc-ui-msg-action-icon-btn" : ""}`}
						title={label}
						aria-label={label}
						onClick={(e) => {
							e.stopPropagation();
							action.onClick?.(message);
						}}
					>
						{Icon ? <Icon size={13} className="cc-ui-msg-action-icon" /> : label}
					</button>
				);
			})}
		</div>
	);
}
