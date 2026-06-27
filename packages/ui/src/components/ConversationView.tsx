import type { AgentMessage } from "@coudycode/agent-core";
import type { AssistantMessage as AssistantMessageType, ToolResultMessage } from "@coudycode/ai";
import { AssistantMessage, type ToolResultIndex } from "./AssistantMessage.tsx";
import { UserMessage } from "./UserMessage.tsx";
import { ToolResult } from "./ToolResult.tsx";
import type { ToolCallStatus } from "./ToolCall.tsx";

export interface ConversationViewProps {
	/** Усі повідомлення розмови. */
	messages: AgentMessage[];
	/** toolCallId → статус (running/done/error). */
	toolStatus?: Record<string, ToolCallStatus>;
	/** Часткове повідомлення, що стрімиться зараз (для курсора). */
	streamingMessage?: AgentMessage;
	/** contentIndex тексту, що стрімиться (у streamingMessage). */
	streamingTextIndex?: number;
	streamingThinkingIndex?: number;
}

/**
 * Рендерить масив AgentMessage[]: user → UserMessage, assistant → AssistantMessage
 * (з приєднанням tool-result'ів до tool-call'ів за toolCallId),
 * toolResult, що не приєднався, рендериться окремо.
 */
export function ConversationView({
	messages,
	toolStatus,
	streamingMessage,
	streamingTextIndex,
	streamingThinkingIndex,
}: ConversationViewProps): React.ReactNode {
	const all = streamingMessage ? [...messages, streamingMessage] : messages;

	// Індекс tool-result'ів за toolCallId (для inline-рендеру під tool-call).
	const toolResultIndex: ToolResultIndex = {};
	for (const m of all) {
		if (typeof m === "object" && m !== null && "role" in m && (m as ToolResultMessage).role === "toolResult") {
			const tr = m as ToolResultMessage;
			(toolResultIndex[tr.toolCallId] ??= []).push({
				toolName: tr.toolName,
				content: tr.content[0] as ToolResultIndex[string][number]["content"],
				isError: tr.isError,
				details: tr.details,
			});
		}
	}
	const joinedToolCallIds = new Set(Object.keys(toolResultIndex));

	return (
		<div className="cc-ui-conversation">
			{all.map((m, idx) => {
				const isStreaming = streamingMessage != null && idx === all.length - 1;
				if (typeof m !== "object" || m === null || !("role" in m)) return null;
				const role = (m as { role: string }).role;

				if (role === "user") {
					return <UserMessage key={idx} message={m as any} />;
				}
				if (role === "assistant") {
					return (
						<AssistantMessage
							key={idx}
							message={m as AssistantMessageType}
							toolResults={toolResultIndex}
							toolStatus={toolStatus}
							streamingTextIndex={isStreaming ? streamingTextIndex : undefined}
							streamingThinkingIndex={isStreaming ? streamingThinkingIndex : undefined}
						/>
					);
				}
				if (role === "toolResult") {
					const tr = m as ToolResultMessage;
					// Tool-result, що вже приєднаний до tool-call — не дублюємо.
					if (joinedToolCallIds.has(tr.toolCallId)) return null;
					return (
						<div key={idx} className="cc-ui-tool">
							<div className="cc-ui-tool-head">
								<span className="cc-ui-tool-name">{tr.toolName}</span>
								<span className={`cc-ui-tool-status ${tr.isError ? "cc-ui-tool-status-error" : "cc-ui-tool-status-done"}`}>
									{tr.isError ? "помилка" : "готово"}
								</span>
							</div>
							<div className="cc-ui-tool-body">
								<ToolResult toolName={tr.toolName} content={tr.content} isError={tr.isError} details={tr.details} />
							</div>
						</div>
					);
				}
				// Кастомні агентні ролі (bashExecution, custom, branchSummary, compactionSummary) — заглушка.
				return (
					<div key={idx} className="cc-ui-msg cc-ui-msg-assistant">
						<div className="cc-ui-msg-body">{renderCustom(m)}</div>
					</div>
				);
			})}
		</div>
	);
}

function renderCustom(m: object): string {
	const r = m as Record<string, unknown>;
	if (typeof r.summary === "string") return r.summary;
	if (typeof r.content === "string") return r.content;
	if (typeof r.command === "string") return `$ ${r.command}`;
	return JSON.stringify(m, null, 2);
}
