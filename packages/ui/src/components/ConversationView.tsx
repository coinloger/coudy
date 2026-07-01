import type { AgentMessage } from "@coudycode/agent-core";
import type {
	AssistantMessage as AssistantMessageType,
	ToolCall as ToolCallContent,
	ToolResultMessage,
} from "@coudycode/ai";
import { AssistantMessage, type ToolResultIndex } from "./AssistantMessage.tsx";
import { UserMessage } from "./UserMessage.tsx";
import { ToolResult } from "./ToolResult.tsx";
import { ToolCall } from "./ToolCall.tsx";
import type { ToolCallStatus } from "./ToolCall.tsx";
import type { MessageAction } from "./message-actions.tsx";

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
	/** Чи показувати завершені thinking-блоки. */
	showCompleted?: boolean;
	/** Компактний режим тулзів (default ON): лише summary-рядки, деталі по кліку. */
	compactTools?: boolean;
	/** Дії на повідомленнях (від плагінів ui:message-actions). */
	messageActions?: MessageAction[];
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
	showCompleted,
	compactTools = true,
	messageActions,
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
					return <UserMessage key={idx} message={m as any} actions={messageActions} />;
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
							showCompleted={showCompleted}
						compactTools={compactTools}
							// Під час стрімінгу дії приховані — доки агент не завершить відповідь.
							actions={isStreaming ? [] : messageActions}
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
				// compactionSummary — рендериться як звичайний tool call «compact» (done).
				if (role === "compactionSummary") {
					const sm = m as { summary?: string; tokensBefore?: number };
					const compactCall: ToolCallContent = {
						type: "toolCall",
						id: `compact-${idx}`,
						name: "compact",
						arguments: { tokensBefore: sm.tokensBefore },
					};
					return (
						<div key={idx} className="cc-ui-msg cc-ui-msg-assistant">
							<ToolCall call={compactCall} status="done">
								{sm.summary ? <div className="cc-ui-compaction-summary">{sm.summary}</div> : undefined}
							</ToolCall>
						</div>
					);
				}
				// branchSummary — системний notice.
				if (role === "branchSummary") {
					const sm = m as { summary?: string; tokensBefore?: number };
					return (
						<div key={idx} className="cc-ui-compaction-notice" role="status">
							Гілку узагальнено
							{typeof sm.tokensBefore === "number" ? ` (${sm.tokensBefore} токенів → summary)` : ""}
							{sm.summary ? (
								<details>
									<summary>показати summary</summary>
									<div className="cc-ui-compaction-summary">{sm.summary}</div>
								</details>
							) : null}
						</div>
					);
				}
				// Інші кастомні агентні ролі — заглушка.
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
