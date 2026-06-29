import { useEffect, useState } from "react";

/** Кадри braille-спінера (CLI-стиль). */
const BRAILLE_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

/** Інтервал кадрів спінера (мс). */
const SPINNER_INTERVAL_MS = 80;

/**
 * Форматувати тривалість у CLI-стиль: `5s`, `9m 31s`, `1h 23m`.
 */
export function formatElapsed(ms: number): string {
	const totalSec = Math.floor(ms / 1000);
	if (totalSec < 60) return `${totalSec}s`;
	const totalMin = Math.floor(totalSec / 60);
	if (totalMin < 60) {
		const s = totalSec % 60;
		return `${totalMin}m ${s}s`;
	}
	const h = Math.floor(totalMin / 60);
	const m = totalMin % 60;
	return `${h}h ${m}m`;
}

/**
 * Форматувати кількість токенів: `350`, `1.2k`, `2.3M`.
 */
export function formatTokenCount(n: number): string {
	if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
	if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
	return String(n);
}

/** Індикатор що агент працює: braille-спінер + label + elapsed + ↓↑токени. */
export interface WorkingIndicatorProps {
	/** Текст (за замовч. "Working..."). */
	label?: string;
	/** Мінулий час (мс) з моменту старту; undefined → не показувати elapsed. */
	elapsedMs?: number;
	/** Accumulated input-токени; undefined → не показувати токени. */
	inputTokens?: number;
	/** Accumulated output-токени; undefined → не показувати токени. */
	outputTokens?: number;
}

export function WorkingIndicator({
	label = "Working...",
	elapsedMs,
	inputTokens,
	outputTokens,
}: WorkingIndicatorProps): React.ReactNode {
	const [frame, setFrame] = useState(BRAILLE_FRAMES[0]);

	useEffect(() => {
		const id = setInterval(() => {
			setFrame((prev) => {
				const idx = BRAILLE_FRAMES.indexOf(prev);
				return BRAILLE_FRAMES[(idx + 1) % BRAILLE_FRAMES.length];
			});
		}, SPINNER_INTERVAL_MS);
		return () => clearInterval(id);
	}, []);

	const showTokens = inputTokens !== undefined && outputTokens !== undefined;
	const elapsed = elapsedMs !== undefined ? formatElapsed(elapsedMs) : null;

	return (
		<span className="cc-ui-working" role="status" aria-label={label}>
			<span className="cc-ui-braille" aria-hidden="true">{frame}</span>
			{label}
			{elapsed !== null ? `(${elapsed})` : ""}
			{showTokens ? `· ↓${formatTokenCount(inputTokens!)} ↑${formatTokenCount(outputTokens!)}` : ""}
		</span>
	);
}
