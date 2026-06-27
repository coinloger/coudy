import { useState } from "react";
import type { ToolCall as ToolCallContent } from "@coudycode/ai";
import { describeToolCall, toolCallPreview } from "./tool-summary.ts";
import {
	DEFAULT_TOOL_ICON,
	Check,
	ChevronDown,
	ChevronRight,
	CircleAlert,
	Loader2,
	TOOL_ICON,
} from "./tool-icons.ts";

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

function StatusIcon({ status }: { status: ToolCallStatus | undefined }): React.ReactNode {
	if (status === "running") return <Loader2 size={13} className="cc-ui-spin" />;
	if (status === "done") return <Check size={13} className="cc-ui-tc-done-icon" />;
	if (status === "error") return <CircleAlert size={13} className="cc-ui-tc-error-icon" />;
	return null;
}

/** Один інструмент: компактний summary-рядок (іконка опис статус chevron) + розкриття деталей. */
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
	const ToolTypeIcon = TOOL_ICON[call.name] ?? DEFAULT_TOOL_ICON;
	const description = describeToolCall(call);
	const preview = toolCallPreview(call);

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
				<span className="cc-ui-tc-typeicon">
					<ToolTypeIcon size={14} />
				</span>
				<span className="cc-ui-tc-desc">{description}</span>
				{status === "running" && <span className="cc-ui-tc-running-text">…</span>}
				<span className="cc-ui-tc-statusicon">
					<StatusIcon status={status} />
				</span>
				<span className="cc-ui-tc-chevron">{open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</span>
			</div>
			{!open && (
				<div className="cc-ui-tc-peek" title={preview}>
					<span className="cc-ui-tc-peek-text">{preview}</span>
				</div>
			)}
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
