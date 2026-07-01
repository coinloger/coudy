import type { AgentMessage } from "@coudycode/agent-core";
import type {
	AssistantMessage as AssistantMessageType,
	ToolCall as ToolCallContent,
	ToolCall as ToolCallBlock,
	ToolResultMessage,
} from "@coudycode/ai";
import { AssistantMessage, type ToolResultIndex } from "./AssistantMessage.tsx";
import { UserMessage } from "./UserMessage.tsx";
import { ToolResult } from "./ToolResult.tsx";
import { ToolCall } from "./ToolCall.tsx";
import type { ToolCallStatus } from "./ToolCall.tsx";
import { BlockView } from "./BlockView.tsx";
import type { MessageAction } from "./message-actions.tsx";

interface BlockRange {
	startIdx: number;
	endIdx: number;
	goal: string;
	summary?: string;
	status: "running" | "done";
	entries: AgentMessage[];
}

const BLOCK_START = "block_start";
const BLOCK_END = "block_end";

function isAssistantMessage(m: unknown): m is AssistantMessageType {
	return typeof m === "object" && m !== null && "role" in m && (m as { role: string }).role === "assistant";
}

function isUserMessage(m: unknown): boolean {
	return typeof m === "object" && m !== null && "role" in m && (m as { role: string }).role === "user";
}

function isToolResultMessage(m: unknown): m is ToolResultMessage {
	return typeof m === "object" && m !== null && "role" in m && (m as { role: string }).role === "toolResult";
}

/** Знайти toolCall-маркер блоку (block_start/block_end) у контенті assistant-повідомлення. */
function getBlockMarker(message: AgentMessage, name: string): ToolCallBlock | null {
	if (!isAssistantMessage(message)) return null;
	const block = message.content.find((c) => c.type === "toolCall" && c.name === name);
	return block && block.type === "toolCall" ? block : null;
}

function markerGoal(marker: ToolCallBlock): string {
	return typeof marker.arguments?.goal === "string" ? marker.arguments.goal : "(без мети)";
}

function markerSummary(marker: ToolCallBlock): string | undefined {
	return typeof marker.arguments?.summary === "string" ? marker.arguments.summary : undefined;
}

/** Побудувати внутрішні повідомлення блоку: прибрати block_start/block_end-маркери
 *  та їхні ack toolResult-и; дропнути повідомлення, що стали порожніми. */
function buildBlockEntries(all: AgentMessage[], startIdx: number, endIdx: number): AgentMessage[] {
	const out: AgentMessage[] = [];
	for (let k = startIdx; k <= endIdx; k++) {
		const m = all[k];
		if (isToolResultMessage(m) && (m.toolName === BLOCK_START || m.toolName === BLOCK_END)) continue;
		if (isAssistantMessage(m)) {
			const hasMarker = m.content.some(
				(c) => c.type === "toolCall" && (c.name === BLOCK_START || c.name === BLOCK_END),
			);
			if (hasMarker) {
				const filtered = m.content.filter(
					(c) => !(c.type === "toolCall" && (c.name === BLOCK_START || c.name === BLOCK_END)),
				);
				if (filtered.length === 0) continue;
				out.push({ ...m, content: filtered });
				continue;
			}
		}
		out.push(m);
	}
	return out;
}

/** Pre-pass: знайти діапазони блоків за block_start/block_end toolCallʼами.
 *  Блок із user-повідомленням всередині — malformed (не створюємо, рендеримо як звичай). */
function findBlocks(all: AgentMessage[]): BlockRange[] {
	const blocks: BlockRange[] = [];
	let i = 0;
	while (i < all.length) {
		const startMarker = getBlockMarker(all[i], BLOCK_START);
		if (!startMarker) {
			i++;
			continue;
		}
		const goal = markerGoal(startMarker);
		let endIdx = -1;
		let summary: string | undefined;
		for (let k = i; k < all.length; k++) {
			const endMarker = getBlockMarker(all[k], BLOCK_END);
			if (endMarker) {
				endIdx = k;
				summary = markerSummary(endMarker);
				break;
			}
		}
		let status: "running" | "done";
		if (endIdx === -1) {
			endIdx = all.length - 1;
			status = "running";
		} else {
			status = "done";
		}
		// Валідація: між block_start і block_end не має бути user-повідомлень.
		let malformed = false;
		for (let k = i; k <= endIdx; k++) {
			if (isUserMessage(all[k])) {
				malformed = true;
				break;
			}
		}
		if (malformed) {
			i++;
			continue;
		}
		blocks.push({
			startIdx: i,
			endIdx,
			goal,
			summary,
			status,
			entries: buildBlockEntries(all, i, endIdx),
		});
		i = endIdx + 1;
	}
	return blocks;
}

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
	const blocks = findBlocks(all);
	const blockByStart = new Map(blocks.map((b) => [b.startIdx, b]));

	const rendered: React.ReactNode[] = [];
	for (let idx = 0; idx < all.length; idx++) {
		const block = blockByStart.get(idx);
		if (block) {
			rendered.push(
				<BlockView
					key={`block-${idx}`}
					goal={block.goal}
					summary={block.summary}
					entries={block.entries}
					status={block.status}
					isStreaming={block.status === "running" && streamingMessage != null}
					toolStatus={toolStatus}
					showCompleted={showCompleted}
				/>,
			);
			idx = block.endIdx;
			continue;
		}
		const m = all[idx];
		const isStreaming = streamingMessage != null && idx === all.length - 1;
		if (typeof m !== "object" || m === null || !("role" in m)) continue;
		const role = (m as { role: string }).role;
		if (role === "user") {
			rendered.push(<UserMessage key={idx} message={m as any} actions={messageActions} />);
			continue;
		}
		if (role === "assistant") {
			rendered.push(
				<AssistantMessage
					key={idx}
					message={m as AssistantMessageType}
					toolResults={toolResultIndex}
					toolStatus={toolStatus}
					streamingTextIndex={isStreaming ? streamingTextIndex : undefined}
					streamingThinkingIndex={isStreaming ? streamingThinkingIndex : undefined}
					showCompleted={showCompleted}
					// Під час стрімінгу дії приховані — доки агент не завершить відповідь.
					actions={isStreaming ? [] : messageActions}
				/>,
			);
			continue;
		}
		if (role === "toolResult") {
			const tr = m as ToolResultMessage;
			// Tool-result, що вже приєднаний до tool-call — не дублюємо.
			if (joinedToolCallIds.has(tr.toolCallId)) continue;
			rendered.push(
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
				</div>,
			);
			continue;
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
			rendered.push(
				<div key={idx} className="cc-ui-msg cc-ui-msg-assistant">
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
			rendered.push(
				<div key={idx} className="cc-ui-compaction-notice" role="status">
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
		rendered.push(
			<div key={idx} className="cc-ui-msg cc-ui-msg-assistant">
				<div className="cc-ui-msg-body">{renderCustom(m)}</div>
			</div>,
		);
	}
	return <div className="cc-ui-conversation">{rendered}</div>;
}

function renderCustom(m: object): string {
	const r = m as Record<string, unknown>;
	if (typeof r.summary === "string") return r.summary;
	if (typeof r.content === "string") return r.content;
	if (typeof r.command === "string") return `$ ${r.command}`;
	return JSON.stringify(m, null, 2);
}
