/**
 * Мок-генератор подій агента для /playground.
 *
 * Симулює стрім реального агента тими ж типами AgentEvent з @coudycode/agent-core:
 * - повідомлення користувача (message_start),
 * - потокова текстова відповідь (text_start/text_delta/text_end),
 * - tool-call'и: read файлу → результат; bash → вивід; edit → diff,
 * - thinking-блок.
 *
 * Покриває всі рендерери UI-двигуна (текст, код, tool read/bash/edit+диф, thinking).
 */
import type { AgentEvent, AgentMessage } from "@coudycode/agent-core";
import type {
	AssistantMessage,
	AssistantMessageEvent,
	ImageContent,
	TextContent,
	ThinkingContent,
	ToolCall,
	ToolResultMessage,
	UserMessage,
	Usage,
} from "@coudycode/ai";

export type MockEventEmitter = (event: AgentEvent) => void;

const USAGE: Usage = {
	input: 100,
	output: 200,
	cacheRead: 0,
	cacheWrite: 0,
	totalTokens: 300,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

const NOW = (): number => Date.now();

function textContent(text: string): TextContent {
	return { type: "text", text };
}
function thinkingContent(thinking: string): ThinkingContent {
	return { type: "thinking", thinking };
}
function toolCall(id: string, name: string, args: Record<string, unknown>): ToolCall {
	return { type: "toolCall", id, name, arguments: args };
}

function assistantMessage(content: AssistantMessage["content"], stopReason: AssistantMessage["stopReason"] = "stop"): AssistantMessage {
	return {
		role: "assistant",
		content,
		api: "anthropic-messages",
		provider: "anthropic",
		model: "claude-3-5-sonnet",
		usage: USAGE,
		stopReason,
		timestamp: NOW(),
	};
}

function toolResultMessage(toolCallId: string, toolName: string, content: (TextContent | ImageContent)[], details?: unknown, isError = false): ToolResultMessage {
	return {
		role: "toolResult",
		toolCallId,
		toolName,
		content,
		details,
		isError,
		timestamp: NOW(),
	};
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Розрізати текст на токени для імітації стрімінгу. */
function tokenize(text: string): string[] {
	return text.match(/\S+\s*|\s+/g) ?? [text];
}

/**
 * Запустити мок-стрім агента для промпту.
 * emit — колбек для подій. Повертає завершені повідомлення.
 */
export async function runMockAgent(prompt: string, emit: MockEventEmitter): Promise<void> {
	await sleep(150);

	// --- Повідомлення користувача ---
	const userMessage: UserMessage = {
		role: "user",
		content: prompt,
		timestamp: NOW(),
	};

	emit({ type: "agent_start" });
	emit({ type: "turn_start" });
	emit({ type: "message_start", message: userMessage });
	emit({ type: "message_end", message: userMessage });

	// --- Асистент: спочатку thinking, потім текст + tool-call'и ---
	await sleep(200);

	// 1) Thinking-блок
	const thinking = "Користувач хоче продемонструвати UI. Прочитаю файл, виконаю команду та відредагую файл, щоб показати всі рендерери.";
	emitAssistantStream(emit, 0, {
		onStart: (p) => {
			p.content = [thinkingContent("")];
		},
		onDelta: (p, delta) => {
			(p.content[0] as ThinkingContent).thinking += delta;
		},
		tokens: tokenize(thinking),
		eventPrefix: "thinking",
	});

	// 2) Текстова відповідь (з markdown + кодом)
	const text =
		"Ось демо всіх рендерерів UI-двигуна. Я прочитаю файл, виконаю команду та внесу правки.\n\n" +
		"Приклад блоку коду:\n\n" +
		"```typescript\n" +
		"function greet(name: string): string {\n" +
		"  return `Привіт, ${name}!`;\n" +
		"}\n" +
		"console.log(greet(\"coudycode\"));\n" +
		"```\n\n" +
		"Тепер виконаю інструменти 👇";

	emitAssistantStream(emit, 1, {
		onStart: (p) => {
			p.content = [...p.content, textContent("")];
		},
		onDelta: (p, delta) => {
			const last = p.content[p.content.length - 1] as TextContent;
			last.text += delta;
		},
		tokens: tokenize(text),
		eventPrefix: "text",
	});

	// Tool-call: read
	const readCallId = "call_read_1";
	const readArgs = { path: "src/index.ts" };
	emit({ type: "tool_execution_start", toolCallId: readCallId, toolName: "read", args: readArgs });
	await sleep(400);
	const readFile = 'export const VERSION = "1.0.0";\nexport function main() {\n  console.log(VERSION);\n}\n';
	emit({
		type: "message_start",
		message: assistantMessage([toolCall(readCallId, "read", readArgs)], "toolUse"),
	});
	emit({ type: "message_end", message: assistantMessage([toolCall(readCallId, "read", readArgs)], "toolUse") });
	const readResult = toolResultMessage(readCallId, "read", [textContent(`Read file [text]\n${readFile}`)], { truncation: { truncated: false } });
	emit({ type: "message_start", message: readResult });
	emit({ type: "message_end", message: readResult });
	emit({ type: "tool_execution_end", toolCallId: readCallId, toolName: "read", result: readResult, isError: false });

	// Tool-call: bash
	const bashCallId = "call_bash_1";
	const bashArgs = { command: "npm run build", timeout: 60 };
	emit({ type: "tool_execution_start", toolCallId: bashCallId, toolName: "bash", args: bashArgs });
	await sleep(600);
	const bashResult = toolResultMessage(bashCallId, "bash", [textContent("$ npm run build\n> @coudycode/coudy@0.1.0 build\n> tsgo -p tsconfig.build.json\n\n✓ built in 643ms")], { truncation: { truncated: false } });
	emit({ type: "message_start", message: bashResult });
	emit({ type: "message_end", message: bashResult });
	emit({ type: "tool_execution_end", toolCallId: bashCallId, toolName: "bash", result: bashResult, isError: false });

	// Tool-call: edit (з дифом)
	const editCallId = "call_edit_1";
	const editArgs = { path: "src/index.ts", edits: [{ oldText: 'export const VERSION = "1.0.0";', newText: 'export const VERSION = "2.0.0";' }] };
	emit({ type: "tool_execution_start", toolCallId: editCallId, toolName: "edit", args: editArgs });
	await sleep(500);
	const editDiff = "--- src/index.ts\n+++ src/index.ts\n@@ -1,3 +1,3 @@\n-export const VERSION = \"1.0.0\";\n+export const VERSION = \"2.0.0\";\n export function main() {\n   console.log(VERSION);\n";
	const editResult = toolResultMessage(editCallId, "edit", [textContent(`Edited src/index.ts`)], { diff: editDiff, patch: editDiff });
	emit({ type: "message_start", message: editResult });
	emit({ type: "message_end", message: editResult });
	emit({ type: "tool_execution_end", toolCallId: editCallId, toolName: "edit", result: editResult, isError: false });

	// Фінальна відповідь
	await sleep(200);
	const finalText = "Готово! Усі інструменти виконано: `read` прочитав файл, `bash` збудував проєкт, а `edit` оновив версію (див. диф вище).";
	emitAssistantStream(emit, 0, {
		onStart: (p) => {
			p.content = [textContent("")];
		},
		onDelta: (p, delta) => {
			(p.content[0] as TextContent).text += delta;
		},
		tokens: tokenize(finalText),
		eventPrefix: "text",
	});

	const finalMessages: AgentMessage[] = [userMessage];
	emit({ type: "turn_end", message: userMessage, toolResults: [readResult, bashResult, editResult] });
	emit({ type: "agent_end", messages: finalMessages });
}

interface StreamSpec {
	onStart: (partial: AssistantMessage) => void;
	onDelta: (partial: AssistantMessage, delta: string) => void;
	tokens: string[];
	eventPrefix: "text" | "thinking";
}

/** Випроменити послідовність text/thinking подій з інкрементальним частковим AssistantMessage. */
async function emitAssistantStream(emit: MockEventEmitter, contentIndex: number, spec: StreamSpec): Promise<void> {
	const partial = assistantMessage([]);
	spec.onStart(partial);

	const startEvt: AssistantMessageEvent =
		spec.eventPrefix === "text"
			? { type: "text_start", contentIndex, partial }
			: { type: "thinking_start", contentIndex, partial };
	emit({ type: "message_start", message: partial });
	emit({ type: "message_update", message: partial, assistantMessageEvent: startEvt });

	for (const token of spec.tokens) {
		spec.onDelta(partial, token);
		const deltaEvt: AssistantMessageEvent =
			spec.eventPrefix === "text"
				? { type: "text_delta", contentIndex, delta: token, partial }
				: { type: "thinking_delta", contentIndex, delta: token, partial };
		emit({ type: "message_update", message: partial, assistantMessageEvent: deltaEvt });
		await sleep(20);
	}

	const endEvt: AssistantMessageEvent =
		spec.eventPrefix === "text"
			? {
					type: "text_end",
					contentIndex,
					content: spec.eventPrefix === "text" ? (partial.content[contentIndex] as TextContent).text : "",
					partial,
				}
			: { type: "thinking_end", contentIndex, content: (partial.content[contentIndex] as ThinkingContent).thinking, partial };
	emit({ type: "message_update", message: partial, assistantMessageEvent: endEvt });
	emit({ type: "message_end", message: partial });
}
