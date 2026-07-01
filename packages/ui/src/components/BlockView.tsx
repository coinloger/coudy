import { useState } from "react";
import type { AgentMessage } from "@coudycode/agent-core";
import { Boxes, ChevronDown, ChevronRight } from "lucide-react";
import { ConversationView } from "./ConversationView.tsx";
import type { ToolResultIndex } from "./AssistantMessage.tsx";
import type { ToolCallStatus } from "./ToolCall.tsx";

export interface BlockViewProps {
	/** Мета блоку з block_start.arguments.goal. */
	goal: string;
	/** Підсумок з block_end.arguments.summary (відсутній у running-блоку). */
	summary?: string;
	/** Внутрішні повідомлення блоку (block_start/block_end-маркери та їхні ack-результати прибрані). */
	entries: AgentMessage[];
	/** Статус блоку. */
	status: "running" | "done";
	/** Чи триває стрімінг цього блоку (для анімації). */
	isStreaming?: boolean;
	/** Спільні контексти рендеру (пробрасуються у внутрішній ConversationView). */
	toolResults?: ToolResultIndex;
	toolStatus?: Record<string, ToolCallStatus>;
	showCompleted?: boolean;
}

/**
 * Logic-блок (block_start → внутрішні тулзи → block_end) як ОДНА collapsible картка.
 * Згорнуто: компактний рядок (іконка + мета + ×N + превʼю підсумку + статус).
 * Розгорнуто: внутрішні повідомлення (через ConversationView) + підсумок.
 */
export function BlockView({
	goal,
	summary,
	entries,
	status,
	isStreaming,
	toolStatus,
	showCompleted,
}: BlockViewProps): React.ReactNode {
	const [open, setOpen] = useState(false);
	const running = status === "running";
	const toolCount = countToolCalls(entries);

	return (
		<div className="cc-ui-block">
			<div
				className="cc-ui-block-head"
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
				<span className="cc-ui-block-chevron">{open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}</span>
				<span className="cc-ui-block-icon">
					<Boxes size={14} />
				</span>
				<span className="cc-ui-block-goal" title={goal}>
					{goal}
				</span>
				<span className="cc-ui-block-count" title={`${toolCount} інструментів у блоці`}>
					× {toolCount}
				</span>
				{!open && summary && <span className="cc-ui-block-preview">· «{previewText(summary)}»</span>}
				<span className={`cc-ui-block-status ${running ? "cc-ui-block-running" : "cc-ui-block-done"}`}>
					{running ? (
						<>
							думаю
							{isStreaming && (
								<span className="cc-ui-block-dots" aria-hidden="true">
									<span />
									<span />
									<span />
								</span>
							)}
						</>
					) : (
						"готово"
					)}
				</span>
			</div>
			{open && (
				<div className="cc-ui-block-body">
					<ConversationView
						messages={entries}
						toolStatus={toolStatus}
						showCompleted={showCompleted}
					/>
					{summary ? (
						<div className="cc-ui-block-summary">
							<span className="cc-ui-block-summary-label">📋 Підсумок:</span> {summary}
						</div>
					) : null}
				</div>
			)}
		</div>
	);
}

/** Кількість toolCall-ів у внутрішніх повідомленнях блоку. */
function countToolCalls(entries: AgentMessage[]): number {
	let n = 0;
	for (const m of entries) {
		if (typeof m === "object" && m !== null && "role" in m && (m as { role: string }).role === "assistant") {
			const content = (m as { content: { type: string }[] }).content;
			for (const c of content) {
				if (c.type === "toolCall") n++;
			}
		}
	}
	return n;
}

/** Перших ~90 символів підсумку в один рядок для превʼю у згорнутому стані. */
function previewText(text: string, max = 90): string {
	const t = text.trim().replace(/\s+/g, " ");
	return t.length > max ? `${t.slice(0, max)}…` : t;
}
