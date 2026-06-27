import { useState } from "react";
import type { ToolCall } from "@coudycode/ai";
import { ToolCall as ToolCallView, type ToolCallStatus } from "./ToolCall.tsx";
import { describeToolGroup, toolCallPreview } from "./tool-summary.ts";
import { Check, ChevronDown, ChevronRight, CircleAlert, CornerDownRight, Loader2 } from "./tool-icons.ts";

/** Поріг: якщо інструментів більше, показуємо перші N + "(+X more)". */
const PREVIEW_LIMIT = 4;

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
 * Група послідовних tool-call'ів: один collapsible блок з агрегованим summary.
 * Розкриття — список окремих інструментів з превʼю + власний expand до повного результату.
 */
export function ToolGroup({ entries }: ToolGroupProps): React.ReactNode {
	const [open, setOpen] = useState(false);
	const [showAll, setShowAll] = useState(false);
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

	const visible = showAll ? entries : entries.slice(0, PREVIEW_LIMIT);
	const hiddenCount = entries.length - visible.length;
	const summary = describeToolGroup(calls);
	const last = entries[entries.length - 1];
	const lastPreview = last ? toolCallPreview(last.call) : "";

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
				<span className="cc-ui-tc-typeicon cc-ui-tc-multi">
					{calls.length}
				</span>
				<span className="cc-ui-tc-desc">{summary}</span>
				{groupStatus === "running" && <span className="cc-ui-tc-running-text">…</span>}
				<span className="cc-ui-tc-statusicon">
					{groupStatus === "running" ? (
						<Loader2 size={13} className="cc-ui-spin" />
					) : groupStatus === "error" ? (
						<CircleAlert size={13} className="cc-ui-tc-error-icon" />
					) : (
						<Check size={13} className="cc-ui-tc-done-icon" />
					)}
				</span>
				<span className="cc-ui-tc-chevron">{open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</span>
			</div>
			{!open && lastPreview && (
				<div className="cc-ui-tc-peek" title={lastPreview}>
					<span className="cc-ui-tc-peek-text">{lastPreview}</span>
				</div>
			)}
			{open && (
				<div className="cc-ui-tg-detail">
					{visible.map((entry, i) => (
						<div className="cc-ui-tg-entry" key={entry.call.id ?? i}>
							<div className="cc-ui-tg-branch" title={toolCallPreview(entry.call)}>
								<CornerDownRight size={13} className="cc-ui-tc-peek-mark" />
								<span className="cc-ui-tc-peek-text">{toolCallPreview(entry.call)}</span>
							</div>
							<ToolCallView call={entry.call} status={entry.status} defaultOpen={entry.status === "error"}>
								{entry.result}
							</ToolCallView>
						</div>
					))}
					{hiddenCount > 0 && (
						<button
							type="button"
							className="cc-ui-tg-more"
							onClick={(e) => {
								e.stopPropagation();
								setShowAll(true);
							}}
						>
							… (+{hiddenCount} more)
						</button>
					)}
				</div>
			)}
		</div>
	);
}
