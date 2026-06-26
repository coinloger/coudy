/**
 * Логіка накопичення стріму: з потоку AgentEvent будує актуальний
 * стан для ConversationView (messages + streaming + tool-статуси).
 *
 * Це міст між агентом (@coudycode/agent-core) та UI.
 */
import type { AgentEvent, AgentMessage } from "@coudycode/agent-core";
import type { ToolCallStatus } from "./components/ToolCall.tsx";

export interface ConversationState {
	/** Завершені повідомлення розмови. */
	messages: AgentMessage[];
	/** Часткове повідомлення, що стрімиться зараз (assistant). */
	streamingMessage?: AgentMessage;
	/** contentIndex тексту/thinking, що стрімиться. */
	streamingTextIndex?: number;
	streamingThinkingIndex?: number;
	/** toolCallId → статус. */
	toolStatus: Record<string, ToolCallStatus>;
	/** Чи активний агент зараз. */
	working: boolean;
}

export const initialConversationState: ConversationState = {
	messages: [],
	toolStatus: {},
	working: false,
};

/**
 * Застосувати подію до стану (імутабельно). Повертає новий стан.
 */
export function applyEvent(state: ConversationState, event: AgentEvent): ConversationState {
	switch (event.type) {
		case "agent_start":
			return { ...state, working: true };
		case "agent_end":
			return {
				...state,
				messages: event.messages,
				streamingMessage: undefined,
				streamingTextIndex: undefined,
				streamingThinkingIndex: undefined,
				working: false,
			};
		case "message_start":
			return { ...state, streamingMessage: event.message };
		case "message_update": {
			const { message, assistantMessageEvent } = event;
			// Останній блок, що стрімиться — за contentIndex з події.
			if ("contentIndex" in assistantMessageEvent) {
				const idx = assistantMessageEvent.contentIndex;
				if (assistantMessageEvent.type.startsWith("text")) {
					return { ...state, streamingMessage: message, streamingTextIndex: idx };
				}
				if (assistantMessageEvent.type.startsWith("thinking")) {
					return { ...state, streamingMessage: message, streamingThinkingIndex: idx };
				}
			}
			return { ...state, streamingMessage: message };
		}
		case "message_end":
			return {
				...state,
				messages: [...state.messages, event.message],
				streamingMessage: undefined,
				streamingTextIndex: undefined,
				streamingThinkingIndex: undefined,
			};
		case "tool_execution_start":
			return {
				...state,
				toolStatus: { ...state.toolStatus, [event.toolCallId]: "running" },
			};
		case "tool_execution_end":
			return {
				...state,
				toolStatus: {
					...state.toolStatus,
					[event.toolCallId]: event.isError ? "error" : "done",
				},
			};
		case "tool_execution_update":
		case "turn_start":
		case "turn_end":
			return state;
		default:
			return state;
	}
}
