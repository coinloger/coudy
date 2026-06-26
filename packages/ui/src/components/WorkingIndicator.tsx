/** Індикатор що агент працює (спінер + текст). */
export interface WorkingIndicatorProps {
	/** Текст під спінером (за замовч. "Працює…"). */
	label?: string;
}

export function WorkingIndicator({ label = "Працює…" }: WorkingIndicatorProps): React.ReactNode {
	return (
		<span className="cc-ui-working">
			<span className="cc-ui-spinner" role="status" aria-label="Працює" />
			{label}
		</span>
	);
}
