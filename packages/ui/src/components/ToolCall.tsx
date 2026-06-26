import { useState } from "react";
import type { ToolCall as ToolCallContent } from "@coudycode/ai";

export type ToolCallStatus = "running" | "done" | "error";

export interface ToolCallProps {
	/** Блок tool-call з контенту асистента. */
	call: ToolCallContent;
	/** Статус виконання (з tool_execution_* подій). */
	status?: ToolCallStatus;
	/** Дочірній вміст — результат інструменту (рендериться у тілі). */
	children?: React.ReactNode;
	/** За замовч. згорнутий під час running, розгорнутий коли done/error. */
	defaultOpen?: boolean;
}

/** Виклик інструменту: ім'я, аргументи (JSON), статус, розгортається/згортається. */
export function ToolCall({ call, status, children, defaultOpen }: ToolCallProps): React.ReactNode {
	const [open, setOpen] = useState<boolean>(defaultOpen ?? status === "error");
	const statusClass =
		status === "running" ? "cc-ui-tool-status-running" : status === "error" ? "cc-ui-tool-status-error" : status === "done" ? "cc-ui-tool-status-done" : "";
	const statusLabel = status === "running" ? "виконується" : status === "error" ? "помилка" : status === "done" ? "готово" : "";
	return (
		<div className="cc-ui-tool">
			<div
				className="cc-ui-tool-head"
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
				<span>{open ? "▼" : "▶"}</span>
				<span className="cc-ui-tool-name">{call.name}</span>
				{statusLabel && <span className={`cc-ui-tool-status ${statusClass}`}>{statusLabel}</span>}
			</div>
			{open && (
				<div className="cc-ui-tool-body">
					{Object.keys(call.arguments ?? {}).length > 0 && (
						<>
							<div className="cc-ui-tool-args-label">Аргументи</div>
							<pre>{JSON.stringify(call.arguments, null, 2)}</pre>
						</>
					)}
					{children && (
						<>
							<div className="cc-ui-tool-result-label">Результат</div>
							{children}
						</>
					)}
				</div>
			)}
		</div>
	);
}
