import type { AssistantMessage as AssistantMessageType } from "@coudycode/ai";
import { MarkdownRenderer } from "./MarkdownRenderer.tsx";
import { ThinkingBlock } from "./ThinkingBlock.tsx";
import { ToolCall } from "./ToolCall.tsx";
import { ToolResult } from "./ToolResult.tsx";
import type { ToolCallStatus } from "./ToolCall.tsx";

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
}

/** Повідомлення асистента: текст (markdown), thinking, tool-call'и з результатами. */
export function AssistantMessage({
	message,
	toolResults,
	toolStatus,
	streamingTextIndex,
	streamingThinkingIndex,
}: AssistantMessageProps): React.ReactNode {
	return (
		<div className="cc-ui-msg cc-ui-msg-assistant">
			<div className="cc-ui-msg-role">Асистент</div>
			{message.content.map((block, idx) => {
				if (block.type === "text") {
					return (
						<MarkdownRenderer
							key={idx}
							content={block.text}
							streaming={streamingTextIndex === idx}
						/>
					);
				}
				if (block.type === "thinking") {
					return (
						<ThinkingBlock
							key={idx}
							content={block}
							streaming={streamingThinkingIndex === idx}
						/>
					);
				}
				if (block.type === "toolCall") {
					const status = toolStatus?.[block.id];
					const results = toolResults?.[block.id];
					return (
						<ToolCall key={idx} call={block} status={status}>
							{results && results.length > 0 && (
								<ToolResult
									toolName={block.name}
									content={results.map((r) => r.content)}
									isError={results.some((r) => r.isError)}
									details={results[0]?.details}
									diff={results[0]?.diff}
								/>
							)}
						</ToolCall>
					);
				}
				return null;
			})}
		</div>
	);
}
