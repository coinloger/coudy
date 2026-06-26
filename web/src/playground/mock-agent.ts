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
 *
 * Темп реалістичний і регулюється множником швидкості (1x дефолт):
 * текст дописується токенами, thinking видимий, tool «працює» (running) перед
 * видачею результату.
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

/** Множник швидкості стріму. delayMs = baseDelay / speed (instant → 0). */
export type MockSpeed = "0.5x" | "1x" | "2x" | "instant";

export interface MockAgentOptions {
	speed?: MockSpeed;
}

const SPEED_FACTOR: Record<MockSpeed, number> = {
	"0.5x": 0.5,
	"1x": 1,
	"2x": 2,
	instant: Infinity,
};

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

/** Створити функцію очікування, що враховує швидкість. */
function makeWait(speed: MockSpeed): (baseMs: number) => Promise<void> {
	const factor = SPEED_FACTOR[speed] ?? 1;
	if (factor === Infinity) {
		// миттєво — yield макротаску, щоб React встиг промалювати, але без затримки
		return () => Promise.resolve();
	}
	return (baseMs) => sleep(baseMs / factor);
}

/**
 * Запустити мок-стрім агента для промпту.
 * emit — колбек для подій; speed — множник темпу.
 */
export async function runMockAgent(prompt: string, emit: MockEventEmitter, options?: MockAgentOptions): Promise<void> {
	const speed: MockSpeed = options?.speed ?? "1x";
	const wait = makeWait(speed);

	// Базові затримки (на 1x).
	const T = {
		phaseGap: 450, // пауза між фазами
		token: 38, // на чанк тексту
		thinkToken: 30, // на чанк thinking
		toolRunning: 1500, // tool «працює» перед результатом
		toolGap: 500, // пауза перед наступним tool
	};

	// --- Повідомлення користувача ---
	const userMessage: UserMessage = {
		role: "user",
		content: prompt,
		timestamp: NOW(),
	};

	await wait(220);
	emit({ type: "agent_start" });
	emit({ type: "turn_start" });
	emit({ type: "message_start", message: userMessage });
	emit({ type: "message_end", message: userMessage });

	await wait(T.phaseGap);

	// 1) Thinking-блок
	const thinking = "Користувач хоче продемонструвати UI. Прочитаю файл, виконаю команду та відредагую файл, щоб показати всі рендерери.";
	await emitAssistantStream(emit, 0, {
		onStart: (p) => {
			p.content = [thinkingContent("")];
		},
		onDelta: (p, delta) => {
			(p.content[0] as ThinkingContent).thinking += delta;
		},
		tokens: tokenize(thinking),
		eventPrefix: "thinking",
		wait,
		tokenDelay: T.thinkToken,
	});

	await wait(T.phaseGap);

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

	await emitAssistantStream(emit, 1, {
		onStart: (p) => {
			p.content = [textContent("")];
		},
		onDelta: (p, delta) => {
			(p.content[0] as TextContent).text += delta;
		},
		tokens: tokenize(text),
		eventPrefix: "text",
		wait,
		tokenDelay: T.token,
	});

	await wait(T.phaseGap);

	// --- Tool-call: read (running → result) ---
	await runTool(emit, {
		callId: "call_read_1",
		toolName: "read",
		args: { path: "src/index.ts" },
		buildResult: () => {
			const readFile = 'export const VERSION = "1.0.0";\nexport function main() {\n  console.log(VERSION);\n}\n';
			return toolResultMessage("call_read_1", "read", [textContent(`Read file [text]\n${readFile}`)], { truncation: { truncated: false } });
		},
		wait,
		runningMs: T.toolRunning,
	});

	await wait(T.toolGap);

	// --- Tool-call: bash ---
	await runTool(emit, {
		callId: "call_bash_1",
		toolName: "bash",
		args: { command: "npm run build", timeout: 60 },
		buildResult: () =>
			toolResultMessage(
				"call_bash_1",
				"bash",
				[textContent("$ npm run build\n> @coudycode/coudy@0.1.0 build\n> tsgo -p tsconfig.build.json\n\n✓ built in 643ms")],
				{ truncation: { truncated: false } },
			),
		wait,
		runningMs: T.toolRunning,
	});

	await wait(T.toolGap);

	// --- Tool-call: edit (з дифом) ---
	const editDiff = "--- src/index.ts\n+++ src/index.ts\n@@ -1,3 +1,3 @@\n-export const VERSION = \"1.0.0\";\n+export const VERSION = \"2.0.0\";\n export function main() {\n   console.log(VERSION);\n";
	await runTool(emit, {
		callId: "call_edit_1",
		toolName: "edit",
		args: { path: "src/index.ts", edits: [{ oldText: 'export const VERSION = "1.0.0";', newText: 'export const VERSION = "2.0.0";' }] },
		buildResult: () => toolResultMessage("call_edit_1", "edit", [textContent(`Edited src/index.ts`)], { diff: editDiff, patch: editDiff }),
		wait,
		runningMs: T.toolRunning,
	});

	await wait(T.phaseGap);

	// Фінальна відповідь
	const finalText = "Готово! Усі інструменти виконано: `read` прочитав файл, `bash` збудував проєкт, а `edit` оновив версію (див. диф вище).";
	await emitAssistantStream(emit, 0, {
		onStart: (p) => {
			p.content = [textContent("")];
		},
		onDelta: (p, delta) => {
			(p.content[0] as TextContent).text += delta;
		},
		tokens: tokenize(finalText),
		eventPrefix: "text",
		wait,
		tokenDelay: T.token,
	});

	const finalMessages: AgentMessage[] = [userMessage];
	emit({ type: "turn_end", message: userMessage, toolResults: [] });
	emit({ type: "agent_end", messages: finalMessages });
}

interface ToolRunSpec {
	callId: string;
	toolName: string;
	args: Record<string, unknown>;
	buildResult: () => ToolResultMessage;
	wait: (baseMs: number) => Promise<void>;
	runningMs: number;
}

/** Виконати tool: emit tool-call → статус running → пауза (видно що працює) → result + done. */
async function runTool(emit: MockEventEmitter, spec: ToolRunSpec): Promise<void> {
	// Спочатку подаємо tool-call як частину асистентного повідомлення.
	const call = toolCall(spec.callId, spec.toolName, spec.args);
	emit({ type: "message_start", message: assistantMessage([call], "toolUse") });
	emit({ type: "message_end", message: assistantMessage([call], "toolUse") });

	// Статус running + витримка — видно що tool «працює».
	emit({ type: "tool_execution_start", toolCallId: spec.callId, toolName: spec.toolName, args: spec.args });
	await spec.wait(spec.runningMs);

	// Результат + done.
	const result = spec.buildResult();
	emit({ type: "message_start", message: result });
	emit({ type: "message_end", message: result });
	emit({ type: "tool_execution_end", toolCallId: spec.callId, toolName: spec.toolName, result, isError: false });
}

interface StreamSpec {
	onStart: (partial: AssistantMessage) => void;
	onDelta: (partial: AssistantMessage, delta: string) => void;
	tokens: string[];
	eventPrefix: "text" | "thinking";
	wait: (baseMs: number) => Promise<void>;
	tokenDelay: number;
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
		await spec.wait(spec.tokenDelay);
	}

	const finalText =
		spec.eventPrefix === "text"
			? (partial.content[contentIndex] as TextContent).text
			: (partial.content[contentIndex] as ThinkingContent).thinking;
	const endEvt: AssistantMessageEvent =
		spec.eventPrefix === "text"
			? { type: "text_end", contentIndex, content: finalText, partial }
			: { type: "thinking_end", contentIndex, content: finalText, partial };
	emit({ type: "message_update", message: partial, assistantMessageEvent: endEvt });
	emit({ type: "message_end", message: partial });
}
