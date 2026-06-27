export interface SystemMessageProps {
	text: string;
}

/** Системна нотатка / статус (UI-специфічне; у @coudycode/ai немає SystemMessage-типу). */
export function SystemMessage({ text }: SystemMessageProps): React.ReactNode {
	return (
		<div className="cc-ui-msg cc-ui-msg-assistant">
			<div className="cc-ui-msg-body">{text}</div>
		</div>
	);
}
