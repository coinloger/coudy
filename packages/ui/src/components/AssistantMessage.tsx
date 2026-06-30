import type { AssistantMessage as AssistantMessageType } from "@coudycode/ai";
import { AlertTriangle } from "lucide-react";
import { MarkdownRenderer } from "./MarkdownRenderer.tsx";
import { ThinkingBlock } from "./ThinkingBlock.tsx";
import { ToolCall } from "./ToolCall.tsx";
import { ToolGroup, type ToolGroupEntry } from "./ToolGroup.tsx";
import { ToolResult } from "./ToolResult.tsx";
import type { ToolCallStatus } from "./ToolCall.tsx";
import { MessageActionsBar } from "./message-actions.tsx";
import type { MessageAction } from "./message-actions.tsx";

/** Індекс результатів для викликів інструментів у цьому повідомленні. */
export type ToolResultIndex = Record<
	string,
	{
		toolName: string;
		content: import("@coudycode/ai").TextContent | import("@coudycode/ai").ImageContent;
		isError?: boolean;
		details?: unknown;
		diff?: { oldContent: string; newContent: string };
	}[]
>;

export interface AssistantMessageProps {
	message: AssistantMessageType;
	/** toolCallId → результат(и) для inline-рендеру під tool-call. */
	toolResults?: ToolResultIndex;
	/** toolCallId → статус виконання (для індикатора). */
	toolStatus?: Record<string, ToolCallStatus>;
	/** Які contentIndex зараз стрімляться (для курсора). */
	streamingTextIndex?: number;
	streamingThinkingIndex?: number;
	/** Чи показувати завершені thinking-блоки. */
	showCompleted?: boolean;
	/** Дії на повідомленнях (від плагінів ui:message-actions). */
	actions?: MessageAction[];
}

/** Один контент-блок у вигляді "сегмента" рендеру. */
type Segment =
	| { kind: "text"; index: number }
	| { kind: "thinking"; index: number }
	| { kind: "tools"; indices: number[] };

/**
 * Розбити контент на сегменти: текст/thinking окремо, послідовні tool-call'и
 * об'єднуються в один tools-сегмент (для групування).
 */
function segmentContent(content: AssistantMessageType["content"]): Segment[] {
	const segments: Segment[] = [];
	for (let i = 0; i < content.length; i++) {
		const block = content[i];
		if (block.type === "toolCall") {
			const last = segments[segments.length - 1];
			if (last && last.kind === "tools") {
				last.indices.push(i);
			} else {
				segments.push({ kind: "tools", indices: [i] });
			}
		} else if (block.type === "text") {
			segments.push({ kind: "text", index: i });
		} else if (block.type === "thinking") {
			segments.push({ kind: "thinking", index: i });
		}
	}
	return segments;
}

/** Повідомлення асистента: текст (markdown), thinking, tool-call'и (з групуванням) з результатами. */
export function AssistantMessage({
	message,
	toolResults,
	toolStatus,
	streamingTextIndex,
	streamingThinkingIndex,
	showCompleted,
	actions,
}: AssistantMessageProps): React.ReactNode {
	const isError = message.stopReason === "error" && !!message.errorMessage;
	const segments = segmentContent(message.content);

	/** Блок помилки моделі/провайдера (видимий, замість порожньої бульки). */
	if (isError) {
		return (
			<div className="cc-ui-msg cc-ui-msg-assistant">
				<div className="cc-ui-msg-error">
					<AlertTriangle size={16} className="cc-ui-msg-error-icon" />
					<div className="cc-ui-msg-error-text">
						<div className="cc-ui-msg-error-title">Помилка відповіді</div>
						<div className="cc-ui-msg-error-body">{message.errorMessage}</div>
					</div>
				</div>
				{actions && actions.length > 0 && <MessageActionsBar message={message as never} actions={actions} />}
			</div>
		);
	}

	/** Побудувати результат для tool-call за його id. */
	const renderResult = (callId: string, toolName: string): React.ReactNode => {
		const results = toolResults?.[callId];
		if (!results || results.length === 0) return undefined;
		return (
			<ToolResult
				toolName={toolName}
				content={results.map((r) => r.content)}
				isError={results.some((r) => r.isError)}
				details={results[0]?.details}
				diff={results[0]?.diff}
			/>
		);
	};

	return (
		<div className="cc-ui-msg cc-ui-msg-assistant">
			{segments.map((seg, sIdx) => {
				if (seg.kind === "text") {
					const block = message.content[seg.index];
					if (block.type !== "text") return null;
					return (
						<div className="cc-ui-msg-card" key={sIdx}>
							<MarkdownRenderer content={block.text} streaming={streamingTextIndex === seg.index} />
						</div>
					);
				}
				if (seg.kind === "thinking") {
					const block = message.content[seg.index];
					if (block.type !== "thinking") return null;
					return <ThinkingBlock key={sIdx} content={block} streaming={streamingThinkingIndex === seg.index} showCompleted={showCompleted} />;
				}
				// tools-сегмент: 1 → ToolCall, >1 → ToolGroup.
				const calls = seg.indices.map((i) => message.content[i]);
				if (calls.length === 1) {
					const block = calls[0];
					if (block.type !== "toolCall") return null;
					return (
						<ToolCall key={sIdx} call={block} status={toolStatus?.[block.id]}>
							{renderResult(block.id, block.name)}
						</ToolCall>
					);
				}
				const entries: ToolGroupEntry[] = calls
					.map((block) => (block.type === "toolCall" ? block : null))
					.filter((b): b is NonNullable<typeof b> => b !== null)
					.map((block) => ({
						call: block,
						status: toolStatus?.[block.id],
						result: renderResult(block.id, block.name),
					}));
				return <ToolGroup key={sIdx} entries={entries} />;
			})}
			{actions && actions.length > 0 && <MessageActionsBar message={message as never} actions={actions} />}
		</div>
	);
}
