import { useState } from "react";
import type { ToolCall as ToolCallContent } from "@coudycode/ai";
import { describeToolCall } from "./tool-summary.ts";

export type ToolCallStatus = "running" | "done" | "error";

export interface ToolCallProps {
	/** Блок tool-call з контенту асистента. */
	call: ToolCallContent;
	/** Статус виконання (з tool_execution_* подій). */
	status?: ToolCallStatus;
	/** Дочірній вміст — результат інструменту (рендериться при розкритті). */
	children?: React.ReactNode;
	/** За замовч. згорнуто. */
	defaultOpen?: boolean;
}

const STATUS_ICON: Record<ToolCallStatus, string> = {
	running: "⏺",
	done: "✓",
	error: "✕",
};

/** Один інструмент: компактний summary-рядок (⏺ опис статус ▸) + розкриття деталей. */
export function ToolCall({ call, status, children, defaultOpen }: ToolCallProps): React.ReactNode {
	const [open, setOpen] = useState<boolean>(defaultOpen ?? false);
	const statusClass =
		status === "running"
			? "cc-ui-tc-running"
			: status === "error"
				? "cc-ui-tc-error"
				: status === "done"
					? "cc-ui-tc-done"
					: "cc-ui-tc-pending";
	const description = describeToolCall(call);

	return (
		<div className="cc-ui-tc">
			<div
				className={`cc-ui-tc-row ${statusClass}`}
				onClick={() => setOpen((v) => !v)}
				role="button"
				tabIndex={0}
				onKeyDown={(e) => {
					if (e.key === "Enter" || e.key === " ") {
						e.preventDefault();
						setOpen((v) => !v);
					}
				}}
			>
				<span className="cc-ui-tc-icon">{status ? STATUS_ICON[status] : "⏺"}</span>
				<span className="cc-ui-tc-desc">{description}</span>
				{status === "running" && <span className="cc-ui-tc-running-text">…</span>}
				<span className="cc-ui-tc-chevron">{open ? "▾" : "▸"}</span>
			</div>
			{open && (
				<div className="cc-ui-tc-detail">
					{Object.keys(call.arguments ?? {}).length > 0 && (
						<>
							<div className="cc-ui-tc-label">Аргументи</div>
							<pre>{JSON.stringify(call.arguments, null, 2)}</pre>
						</>
					)}
					{children && (
						<>
							<div className="cc-ui-tc-label">Результат</div>
							{children}
						</>
					)}
				</div>
			)}
		</div>
	);
}
