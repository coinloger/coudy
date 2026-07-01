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
import { ToolActivity, type ToolActivityEntry } from "./ToolActivity.tsx";
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
	/** Дії на повідомленнях (від плагінів ui:message-actions). */
	messageActions?: MessageAction[];
}

function isAssistantMessage(m: object): m is AssistantMessageType {
	return typeof m === "object" && m !== null && "role" in m && (m as { role: string }).role === "assistant";
}

/**
 * Рендерить розмову як діалог Q&A: user-повідомлення + assistant-текст-відповіді.
 * УСІ інструменти ходу (між user-повідомленням і фінальною відповіддю) згортаються
 * в ОДИН мінімальний expandable блок (ToolActivity) — не стіна карток. Деталі
 * інструментів доступні по кліку.
 */
export function ConversationView({
	messages,
	toolStatus,
	streamingMessage,
	streamingTextIndex,
	streamingThinkingIndex,
	showCompleted,
	messageActions,
}: ConversationViewProps): React.ReactNode {
	const all = streamingMessage ? [...messages, streamingMessage] : messages;

	// Індекс tool-result'ів за toolCallId (для inline-рендеру в деталях тулзів).
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

	/** Побудувати результат для tool-call за його id (для деталей у ToolActivity). */
	const renderResult = (callId: string, toolName: string): React.ReactNode => {
		const results = toolResultIndex[callId];
		if (!results || results.length === 0) return undefined;
		return (
			<ToolResult
				toolName={toolName}
				content={results.map((r) => r.content)}
				isError={results.some((r) => r.isError)}
				details={results[0]?.details}
			/>
		);
	};

	const rendered: React.ReactNode[] = [];
	// Зібрати tool-виклики поточного ходу (скидаються на початку кожного ходу).
	let turnTools: ToolActivityEntry[] = [];
	let keyCounter = 0;

	const flushTools = (): void => {
		if (turnTools.length > 0) {
			rendered.push(<ToolActivity key={`tools-${keyCounter++}`} entries={turnTools} />);
			turnTools = [];
		}
	};

	for (let idx = 0; idx < all.length; idx++) {
		const m = all[idx];
		const isStreaming = streamingMessage != null && idx === all.length - 1;
		if (typeof m !== "object" || m === null || !("role" in m)) continue;
		const role = (m as { role: string }).role;

		// Новий хід: user-повідомлення стартує новий turn. Спершу флеш тулзи попереднього ходу.
		if (role === "user") {
			flushTools();
			rendered.push(<UserMessage key={`u-${idx}`} message={m as any} actions={messageActions} />);
			continue;
		}

		// Assistant: зібрати tool-виклики в поточний хід; текст/thinking рендерити на місці.
		// ToolActivity (зібрані тулзи) флешиться ПЕРЕД першим текст-блоком відповіді —
		// тулзи передують фінальній відповіді (читабельність Q&A).
		if (role === "assistant") {
			const am = m as AssistantMessageType;
			if (isAssistantMessage(am)) {
				const hasText = am.content.some((b) => b.type === "text");
				const hasThinking = am.content.some((b) => b.type === "thinking");
				const thinkingShown = hasThinking && (isStreaming || showCompleted);
				for (const block of am.content) {
					if (block.type === "toolCall") {
						turnTools.push({
							call: block,
							status: toolStatus?.[block.id],
							result: renderResult(block.id, block.name),
						});
					}
				}
				// Флешити тулзи ПЕРЕД будь-яким видимим контентом (текст ЧИ thinking) —
				// послідовний порядок ходу: activity (робота) → reasoning → answer.
				if (hasText || thinkingShown) flushTools();
				// Tool-only крок (немає видимого контенту при hideTools) → порожня бульбашка з
				// діями (часом) без сенсу. Пропустити рендер, окрім активного streaming-кроку
				// (може ще не мати тексту але стрімиться). Тулзи вже у ToolActivity.
				if (!hasText && !thinkingShown && !isStreaming) continue;
			}
			rendered.push(
				<AssistantMessage
					key={`a-${idx}`}
					message={am}
					toolResults={toolResultIndex}
					toolStatus={toolStatus}
					streamingTextIndex={isStreaming ? streamingTextIndex : undefined}
					streamingThinkingIndex={isStreaming ? streamingThinkingIndex : undefined}
					showCompleted={showCompleted}
					// Тулзи рендеряться згруповано (ToolActivity); тут лише текст/thinking.
					hideTools
					// Під час стрімінгу дії приховані — доки агент не завершить відповідь.
					actions={isStreaming ? [] : messageActions}
				/>,
			);
			continue;
		}

		// toolResult: приєднаний до tool-call (обробляється в деталях ToolActivity) —
		// пропускати тут (не дублюємо окремою карткою).
		if (role === "toolResult") continue;

		// compactionSummary — рендериться як звичайний tool call «compact» (done).
		if (role === "compactionSummary") {
			const sm = m as { summary?: string; tokensBefore?: number };
			const compactCall: ToolCallContent = {
				type: "toolCall",
				id: `compact-${idx}`,
				name: "compact",
				arguments: { tokensBefore: sm.tokensBefore },
			};
			flushTools();
			rendered.push(
				<div key={`compact-${idx}`} className="cc-ui-msg cc-ui-msg-assistant">
					<ToolCall call={compactCall} status="done">
						{sm.summary ? <div className="cc-ui-compaction-summary">{sm.summary}</div> : undefined}
					</ToolCall>
				</div>,
			);
			continue;
		}

		// branchSummary — системний notice.
		if (role === "branchSummary") {
			const sm = m as { summary?: string; tokensBefore?: number };
			flushTools();
			rendered.push(
				<div key={`branch-${idx}`} className="cc-ui-compaction-notice" role="status">
					Гілку узагальнено
					{typeof sm.tokensBefore === "number" ? ` (${sm.tokensBefore} токенів → summary)` : ""}
					{sm.summary ? (
						<details>
							<summary>показати summary</summary>
							<div className="cc-ui-compaction-summary">{sm.summary}</div>
						</details>
					) : null}
				</div>,
			);
			continue;
		}

		// Інші кастомні агентні ролі — заглушка.
		flushTools();
		rendered.push(
			<div key={`custom-${idx}`} className="cc-ui-msg cc-ui-msg-assistant">
				<div className="cc-ui-msg-body">{renderCustom(m)}</div>
			</div>,
		);
	}
	// Флеш решти тулзів останнього ходу.
	flushTools();

	return <div className="cc-ui-conversation">{rendered}</div>;
}

function renderCustom(m: object): string {
	const r = m as Record<string, unknown>;
	if (typeof r.summary === "string") return r.summary;
	if (typeof r.content === "string") return r.content;
	if (typeof r.command === "string") return `$ ${r.command}`;
	return JSON.stringify(m, null, 2);
}
