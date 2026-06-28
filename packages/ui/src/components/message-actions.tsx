import type { AgentMessage } from "@coudycode/agent-core";

/**
 * Дія на повідомлення (hover), додана плагіном через ui:message-actions.
 * Викликається з самим повідомленням при кліку.
 */
export interface MessageAction {
	id: string;
	label: string;
	/** Назва іконки Lucide (опц., ігнорується в headless UI). */
	icon?: string;
	onClick: (message: AgentMessage) => void;
}

export interface MessageActionsBarProps {
	/** Повідомлення, до якого привʼязані дії. */
	message: AgentMessage;
	/** Дії (від плагінів). */
	actions: MessageAction[];
}

/**
 * Рядок дій при hover на повідомленнях (Claude Code-стайл).
 * Рендериться в обгортці повідомлення; показується через CSS :hover батька.
 */
export function MessageActionsBar({ message, actions }: MessageActionsBarProps): React.ReactNode {
	if (actions.length === 0) return null;
	return (
		<div className="cc-ui-msg-actions">
			{actions.map((action) => (
				<button
					key={action.id}
					type="button"
					className="cc-ui-msg-action"
					title={action.label}
					onClick={(e) => {
						e.stopPropagation();
						action.onClick(message);
					}}
				>
					{action.label}
				</button>
			))}
		</div>
	);
}
