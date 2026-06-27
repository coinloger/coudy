import { useState } from "react";
import type { ToolCall } from "@coudycode/ai";
import { ToolCall as ToolCallView, type ToolCallStatus } from "./ToolCall.tsx";
import { describeToolGroup, toolCallPreview } from "./tool-summary.ts";

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
 * Група послідовних tool-call'ів: один collapsible блок з агрегованим summary
 * ("Reading 6 files" / "Reading 3 files, editing 2 files"). Розкриття — список
 * окремих інструментів (⎿ превʼю + власний expand до повного результату).
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
				<span className="cc-ui-tc-icon">⏺</span>
				<span className="cc-ui-tc-desc">{summary}</span>
				{groupStatus === "running" && <span className="cc-ui-tc-running-text">…</span>}
				<span className="cc-ui-tc-chevron">{open ? "▾" : "▸"}</span>
			</div>
			{open && (
				<div className="cc-ui-tg-detail">
					{visible.map((entry, i) => (
						<div className="cc-ui-tg-entry" key={entry.call.id ?? i}>
							<div className="cc-ui-tg-branch" title={toolCallPreview(entry.call)}>
								⎿ {toolCallPreview(entry.call)}
							</div>
							<ToolCallView call={entry.call} status={entry.status}>
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
