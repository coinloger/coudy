import { useState } from "react";
import type { ToolCall } from "@coudycode/ai";
import { ToolCall as ToolCallView, type ToolCallStatus } from "./ToolCall.tsx";
import { describeToolGroup, toolCallPreview } from "./tool-summary.ts";
import {
	ChevronDown,
	ChevronRight,
	CircleAlert,
	CornerDownRight,
	DEFAULT_TOOL_ICON,
	Loader2,
	TOOL_ICON,
} from "./tool-icons.ts";

export interface ToolGroupEntry {
	call: ToolCall;
	status?: ToolCallStatus;
	/** Результат інструменту для розкриття. */
	result?: React.ReactNode;
}

export interface ToolGroupProps {
	/** Послідовні виклики інструментів, що групуються. */
	entries: ToolGroupEntry[];
}

/**
 * Група послідовних tool-call'ів: один компактний рядок (як одиничний tool)
 * + кнопка «показати більше (N)», що розкриває список окремих інструментів.
 */
export function ToolGroup({ entries }: ToolGroupProps): React.ReactNode {
	const [open, setOpen] = useState(false);
	const calls = entries.map((e) => e.call);

	// Статус групи: якщо будь-який running → running; якщо будь-який error → error; інакше done.
	const groupStatus: ToolCallStatus = entries.some((e) => e.status === "running")
		? "running"
		: entries.some((e) => e.status === "error")
			? "error"
			: "done";

	const statusClass =
		groupStatus === "running"
			? "cc-ui-tc-running"
			: groupStatus === "error"
				? "cc-ui-tc-error"
				: "cc-ui-tc-done";

	const summary = describeToolGroup(calls);
	const last = entries[entries.length - 1];
	const lastPreview = last ? toolCallPreview(last.call) : "";
	const LastToolIcon = last ? (TOOL_ICON[last.call.name] ?? DEFAULT_TOOL_ICON) : DEFAULT_TOOL_ICON;

	return (
		<div className="cc-ui-tc cc-ui-tg">
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
				<span className="cc-ui-tc-typeicon">
					{groupStatus === "running" ? (
						<Loader2 size={14} className="cc-ui-spin" />
					) : groupStatus === "error" ? (
						<CircleAlert size={14} className="cc-ui-tc-error-icon" />
					) : (
						<LastToolIcon size={14} />
					)}
				</span>
				<span className="cc-ui-tc-desc">{summary}</span>
				{groupStatus === "running" && <span className="cc-ui-tc-running-text">…</span>}
				<button
					type="button"
					className="cc-ui-tg-toggle"
					onClick={(e) => {
						e.stopPropagation();
						setOpen((v) => !v);
					}}
					title={open ? "Згорнути список" : `Показати всі ${calls.length} інструментів`}
				>
					{open ? "згорнути" : `показати більше (${calls.length})`}
					{open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
				</button>
			</div>
			{!open && lastPreview && lastPreview.trim() !== summary.trim() && (
				<div className="cc-ui-tc-peek" title={lastPreview}>
					<CornerDownRight size={13} className="cc-ui-tc-peek-mark" />
					<span className="cc-ui-tc-peek-text">{lastPreview}</span>
				</div>
			)}
			{open && (
				<div className="cc-ui-tg-detail">
					{entries.map((entry, i) => (
						<div className="cc-ui-tg-entry" key={entry.call.id ?? i}>
							<ToolCallView
								call={entry.call}
								status={entry.status}
								defaultOpen={entry.status === "error"}
							>
								{entry.result}
							</ToolCallView>
						</div>
					))}
				</div>
			)}
		</div>
	);
}
