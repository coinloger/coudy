/**
 * Мок-генератор подій агента для /playground.
 *
 * Симулює повноцінну багату сесію агента тими ж типами AgentEvent з @coudycode/agent-core.
 * Стрес-тест UI-двигуна: проганяє ВСІ рендерери — насичений streaming-markdown
 * (заголовки/списки/таблиці/blockquote/посилання/inline-code/код у 4 мовах),
 * усі 8 інструментів з різноманітними результатами (включно edit/write з unified-diff
 * та ≥1 помилкою), кілька thinking-блоків.
 *
 * Темп реалістичний і регулюється множником швидкості (1x дефолт).
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

function toolResultMessage(
	toolCallId: string,
	toolName: string,
	content: (TextContent | ImageContent)[],
	details?: unknown,
	isError = false,
): ToolResultMessage {
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

/** Розрізати текст на токени для імітації стрімінгу (по слову + пробілу). */
function tokenize(text: string): string[] {
	return text.match(/\S+\s*|\s+/g) ?? [text];
}

/** Зібрати markdown з рядків (backticks безпечні у double-quoted рядках). */
const md = (...lines: string[]): string => lines.join("\n");

/** Створити функцію очікування, що враховує швидкість. */
function makeWait(speed: MockSpeed): (baseMs: number) => Promise<void> {
	const factor = SPEED_FACTOR[speed] ?? 1;
	if (factor === Infinity) {
		return () => Promise.resolve();
	}
	return (baseMs) => sleep(baseMs / factor);
}

/** Блок контенту для потокового AssistantMessage. */
interface BlockSpec {
	type: "text" | "thinking";
	text: string;
}

interface StreamOpts {
	wait: (baseMs: number) => Promise<void>;
	tokenDelay: number;
	thinkTokenDelay: number;
}

/**
 * Стрімити одне AssistantMessage з послідовністю блоків (thinking + text)
 * з інкрементальним contentIndex — як реальна відповідь асистента.
 */
async function streamAssistantMessage(emit: MockEventEmitter, blocks: BlockSpec[], opts: StreamOpts): Promise<void> {
	const partial = assistantMessage([]);
	for (const b of blocks) {
		partial.content.push(b.type === "text" ? textContent("") : thinkingContent(""));
	}

	emit({ type: "message_start", message: partial });

	blocks.forEach((block, ci) => {
		const prefix = block.type === "thinking" ? "thinking" : "text";
		emit({
			type: "message_update",
			message: partial,
			assistantMessageEvent: { type: `${prefix}_start`, contentIndex: ci, partial } as AssistantMessageEvent,
		});
	});

	for (let ci = 0; ci < blocks.length; ci++) {
		const block = blocks[ci];
		const prefix = block.type === "thinking" ? "thinking" : "text";
		const tokens = tokenize(block.text);
		for (const token of tokens) {
			if (block.type === "thinking") {
				(partial.content[ci] as ThinkingContent).thinking += token;
			} else {
				(partial.content[ci] as TextContent).text += token;
			}
			emit({
				type: "message_update",
				message: partial,
				assistantMessageEvent: {
					type: `${prefix}_delta`,
					contentIndex: ci,
					delta: token,
					partial,
				} as AssistantMessageEvent,
			});
			await opts.wait(prefix === "thinking" ? opts.thinkTokenDelay : opts.tokenDelay);
		}
		const finalText =
			block.type === "thinking"
				? (partial.content[ci] as ThinkingContent).thinking
				: (partial.content[ci] as TextContent).text;
		emit({
			type: "message_update",
			message: partial,
			assistantMessageEvent: { type: `${prefix}_end`, contentIndex: ci, content: finalText, partial } as AssistantMessageEvent,
		});
	}

	emit({ type: "message_end", message: partial });
}

interface ToolRunSpec {
	callId: string;
	toolName: string;
	args: Record<string, unknown>;
	buildResult: () => ToolResultMessage;
	wait: (baseMs: number) => Promise<void>;
	runningMs: number;
	isError?: boolean;
}

/** Виконати tool: emit tool-call → статус running → пауза (видно що працює) → result + end. */
async function runTool(emit: MockEventEmitter, spec: ToolRunSpec): Promise<void> {
	const isError = spec.isError ?? false;
	const call = toolCall(spec.callId, spec.toolName, spec.args);
	emit({ type: "message_start", message: assistantMessage([call], "toolUse") });
	emit({ type: "message_end", message: assistantMessage([call], "toolUse") });

	emit({ type: "tool_execution_start", toolCallId: spec.callId, toolName: spec.toolName, args: spec.args });
	await spec.wait(spec.runningMs);

	const result = spec.buildResult();
	emit({ type: "message_start", message: result });
	emit({ type: "message_end", message: result });
	emit({ type: "tool_execution_end", toolCallId: spec.callId, toolName: spec.toolName, result, isError });
}

/**
 * Запустити мок-стрім агента для промпту — повноцінна багата сесія.
 * emit — колбек для подій; speed — множник темпу.
 */
export async function runMockAgent(prompt: string, emit: MockEventEmitter, options?: MockAgentOptions): Promise<void> {
	const speed: MockSpeed = options?.speed ?? "1x";
	const wait = makeWait(speed);

	const T = {
		phaseGap: 450,
		token: 32,
		thinkToken: 26,
		toolRunning: 1400,
		bashRunning: 2000,
		toolGap: 480,
	};
	const streamOpts: StreamOpts = { wait, tokenDelay: T.token, thinkTokenDelay: T.thinkToken };

	// --- Повідомлення користувача ---
	const userMessage: UserMessage = { role: "user", content: prompt, timestamp: NOW() };
	await wait(220);
	emit({ type: "agent_start" });
	emit({ type: "turn_start" });
	emit({ type: "message_start", message: userMessage });
	emit({ type: "message_end", message: userMessage });
	await wait(T.phaseGap);

	// === Фаза 1: thinking + intro ===
	await streamAssistantMessage(
		emit,
		[
			{
				type: "thinking",
				text: "Користувач хоче розібратись з проектом coudycode і додати фічу. Спершу вивчу структуру: лістинг кореня, package.json, потім пошукаю ключові патерни коду.",
			},
			{
				type: "text",
				text: "Допоможу розібратись з **coudycode** і додати фічу! Спочатку вивчу структуру проекту — лістинг директорії та основні файли.",
			},
		],
		streamOpts,
	);
	await wait(T.phaseGap);

	// === Раунд інструментів 1: ls + read ===
	await runTool(emit, {
		callId: "call_ls_1",
		toolName: "ls",
		args: { path: "." },
		buildResult: () =>
			toolResultMessage("call_ls_1", "ls", [
				textContent(
					md(
						"📁 packages/",
						"   core/   ai/   agent-core/   tools/   ui/",
						"📁 server/",
						"📁 web/",
						"📁 plugins/",
						"📄 package.json        792B",
						"📄 README.md           11KB",
						"📄 tsconfig.base.json  512B",
					),
				),
			]),
		wait,
		runningMs: T.toolRunning,
	});
	await wait(T.toolGap);
	await runTool(emit, {
		callId: "call_read_1",
		toolName: "read",
		args: { path: "package.json" },
		buildResult: () =>
			toolResultMessage(
				"call_read_1",
				"read",
				[
					textContent(
						md(
							"Read file [text] package.json",
							"{",
							'  "name": "coudycode",',
							'  "version": "0.1.0",',
							'  "type": "module",',
							'  "private": true,',
							'  "workspaces": ["packages/*", "server", "web"],',
							'  "scripts": {',
							'    "dev": "concurrently \\"npm run dev:server\\" \\"npm run dev:web\\"",',
							'    "build": "npm run build --workspaces --if-present"',
							"  }",
							"}",
						),
					),
				],
				{ truncation: { truncated: false } },
			),
		wait,
		runningMs: T.toolRunning,
	});
	await wait(T.phaseGap);

	// === Фаза 2: thinking + текст ===
	await streamAssistantMessage(
		emit,
		[
			{
				type: "thinking",
				text: "Бачу workspace-monorepo: core, ai, agent-core, tools, ui, server, web. Тепер пошукаю де визначено AgentMessage та інструменти, щоб зрозуміти куди додавати фічу.",
			},
			{
				type: "text",
				text: "Проект — **workspace-monorepo** з ізоморфним ядром. Пошукаю по коду ключові визначення (`AgentMessage`, інструменти) та файли `.tsx`.",
			},
		],
		streamOpts,
	);
	await wait(T.phaseGap);

	// === Раунд інструментів 2: grep + find + read ===
	await runTool(emit, {
		callId: "call_grep_1",
		toolName: "grep",
		args: { pattern: "AgentMessage", path: "packages/agent/src", glob: "*.ts" },
		buildResult: () =>
			toolResultMessage(
				"call_grep_1",
				"grep",
				[
					textContent(
						md(
							"packages/agent/src/types.ts:67:export type AgentMessage = Message | CustomAgentMessages[keyof CustomAgentMessages];",
							"packages/agent/src/types.ts:321:	set messages(messages: AgentMessage[]);",
							"packages/agent/src/harness/messages.ts:118:export function convertToLlm(messages: AgentMessage[]): Message[] {",
							"packages/agent/src/agent.ts:42:	private messages: AgentMessage[] = [];",
						),
					),
				],
				{ truncation: { truncated: false } },
			),
		wait,
		runningMs: T.toolRunning,
	});
	await wait(T.toolGap);
	await runTool(emit, {
		callId: "call_find_1",
		toolName: "find",
		args: { pattern: "*.tsx", path: "web/src" },
		buildResult: () =>
			toolResultMessage(
				"call_find_1",
				"find",
				[
					textContent(
						md(
							"web/src/App.tsx",
							"web/src/Sidebar.tsx",
							"web/src/Dashboard.tsx",
							"web/src/PluginManager.tsx",
							"web/src/ChatView.tsx",
							"web/src/Settings.tsx",
							"web/src/playground/Playground.tsx",
						),
					),
				],
				{ truncation: { truncated: false } },
			),
		wait,
		runningMs: T.toolRunning,
	});
	await wait(T.toolGap);
	await runTool(emit, {
		callId: "call_read_2",
		toolName: "read",
		args: { path: "web/src/App.tsx", offset: 86, limit: 12 },
		buildResult: () =>
			toolResultMessage(
				"call_read_2",
				"read",
				[
					textContent(
						md(
							"Read file [text] web/src/App.tsx (lines 86-97)",
							"<Routes>",
							'  <Route path="/" element={<Dashboard widgets={ui.dashboardWidgets} />} />',
							'  <Route path="/dashboard" element={<Dashboard widgets={ui.dashboardWidgets} />} />',
							'  <Route path="/plugins" element={<PluginManager />} />',
							'  <Route path="/settings" element={<Settings />} />',
							'  <Route path="/playground" element={<Playground />} />',
							"</Routes>",
						),
					),
				],
				{ truncation: { truncated: false } },
			),
		wait,
		runningMs: T.toolRunning,
	});
	await wait(T.phaseGap);

	// === Фаза 3: thinking + НАСИЧЕНИЙ markdown (усі елементи + код у 4 мовах) ===
	const richMarkdown = md(
		"## Архітектура coudycode",
		"",
		"Проект — **workspace-monorepo** з *ізоморфним* ядром (hook-engine працює і на бекенді, і в браузері). Докладніше в [документації](https://github.com/coinloger/coudy).",
		"",
		"> Хуки — це точки розширення: **actions** (побічні ефекти) та **filters** (трансформації значень), як у WordPress.",
		"",
		"### Структура пакетів",
		"",
		"- `packages/core` — hook-engine + типи",
		"- `packages/ai` — LLM-абстракція (уніфікований API провайдерів)",
		"- `packages/agent-core` — agent runtime",
		"- `packages/tools` — інструменти (`read`/`edit`/`write`/`bash`/`grep`/`find`/`ls`/`fetch`)",
		"",
		"Порядок додавання фічі:",
		"",
		"1. Вивчити існуючий код",
		"2. Написати реалізацію",
		"3. Покрити тестами",
		"4. Зібрати проєкт",
		"",
		"### Приклад: TypeScript",
		"",
		"```typescript",
		"import { HookEngine } from \"@coudycode/core\";",
		"",
		"const hooks = new HookEngine();",
		"hooks.addFilter(\"ui:menu\", (items) => [...items, { id: \"x\", label: \"X\" }]);",
		"const result = await hooks.applyFilters(\"ui:menu\", []);",
		"console.log(result); // [{ id: \"x\", label: \"X\" }]",
		"```",
		"",
		"### Приклад: Python",
		"",
		"```python",
		"def greet(name: str) -> str:",
		'    return f"Привіт, {name}!"',
		"",
		"for i in range(3):",
		'    print(greet(f"user_{i}"))',
		"```",
		"",
		"### Приклад: Bash",
		"",
		"```bash",
		"#!/usr/bin/env bash",
		"set -euo pipefail",
		"npm run build --workspace=packages/core",
		'echo "✓ Built core"',
		"```",
		"",
		"### Приклад: JSON-конфіг",
		"",
		"```json",
		"{",
		'  "name": "coudycode",',
		'  "version": "0.1.0",',
		'  "type": "module"',
		"}",
		"```",
		"",
		"### Таблиця залежностей",
		"",
		"| Пакет | Версія | Призначення |",
		"|-------|--------|-------------|",
		"| `@coudycode/core` | 0.1.0 | hook-engine |",
		"| `@coudycode/ai` | 0.83.0 | LLM-абстракція |",
		"| `@coudycode/tools` | 0.1.0 | інструменти |",
		"| `@coudycode/ui` | 0.1.0 | React UI-двигун |",
		"",
		"---",
		"",
		"Тепер додам фічу — відредагую існуючий файл, створю новий і зберу проєкт.",
	);
	await streamAssistantMessage(
		emit,
		[
			{ type: "thinking", text: "Архітектура зрозуміла. Тепер додам фічу: відредагую конфіг, створю новий утилітний модуль і зберу проєкт, щоб переконатись що нічого не зламалось." },
			{ type: "text", text: richMarkdown },
		],
		streamOpts,
	);
	await wait(T.phaseGap);

	// === Раунд інструментів 3: edit + write + bash ===
	const editDiff = md(
		"--- packages/core/src/index.ts",
		"+++ packages/core/src/index.ts",
		"@@ -1,4 +1,5 @@",
		' export { HookEngine, hooks } from "./hooks.js";',
		"-export { CoreHooks } from \"./types.js\";",
		'+export { CoreHooks, PluginManifest } from "./types.js";',
		" export type {",
		"   PluginContext,",
	);
	await runTool(emit, {
		callId: "call_edit_1",
		toolName: "edit",
		args: { path: "packages/core/src/index.ts", edits: [{ oldText: 'export { CoreHooks } from "./types";', newText: 'export { CoreHooks, PluginManifest } from "./types";' }] },
		buildResult: () => toolResultMessage("call_edit_1", "edit", [textContent("Edited packages/core/src/index.ts")], { diff: editDiff, patch: editDiff }),
		wait,
		runningMs: T.toolRunning,
	});
	await wait(T.toolGap);
	const writeDiff = md(
		"--- /dev/null",
		"+++ packages/core/src/utils.ts",
		"@@ -0,0 +1,4 @@",
		"+/** Спільні утиліти ядра. */",
		"+export function uid(prefix = \"id\"): string {",
		'+  return `${prefix}_${Date.now().toString(36)}`;',
		"+}",
	);
	await runTool(emit, {
		callId: "call_write_1",
		toolName: "write",
		args: { path: "packages/core/src/utils.ts", content: "export function uid(prefix = \"id\"): string {\n  return `${prefix}_${Date.now().toString(36)}`;\n}\n" },
		buildResult: () => toolResultMessage("call_write_1", "write", [textContent("Created packages/core/src/utils.ts")], { diff: writeDiff, patch: writeDiff }),
		wait,
		runningMs: T.toolRunning,
	});
	await wait(T.toolGap);
	await runTool(emit, {
		callId: "call_bash_1",
		toolName: "bash",
		args: { command: "npm run build --workspace=packages/core", timeout: 60 },
		buildResult: () =>
			toolResultMessage(
				"call_bash_1",
				"bash",
				[
					textContent(
						md(
							"$ npm run build --workspace=packages/core",
							"> @coudycode/core@0.1.0 build",
							"> tsc",
							"",
							"packages/core/src/hooks.ts   ✓",
							"packages/core/src/types.ts   ✓",
							"packages/core/src/utils.ts   ✓",
							"packages/core/src/index.ts   ✓",
							"",
							"✓ built in 412ms",
						),
					),
				],
				{ truncation: { truncated: false } },
			),
		wait,
		runningMs: T.bashRunning,
	});
	await wait(T.phaseGap);

	// === Раунд інструментів 4: fetch (JSON) ===
	await runTool(emit, {
		callId: "call_fetch_1",
		toolName: "fetch",
		args: { url: "https://api.github.com/repos/coinloger/coudy" },
		buildResult: () =>
			toolResultMessage(
				"call_fetch_1",
				"fetch",
				[
					textContent(
						md(
							"{",
							'  "full_name": "coinloger/coudy",',
							'  "description": "Мульти-агентна платформа з плагінною системою",',
							'  "language": "TypeScript",',
							'  "stargazers_count": 42,',
							'  "default_branch": "main"',
							"}",
						),
					),
				],
				{ truncation: { truncated: false } },
			),
		wait,
		runningMs: T.toolRunning,
	});
	await wait(T.phaseGap);

	// === Раунд інструментів 5: ПОМИЛКА (read неіснуючого файлу) ===
	await runTool(emit, {
		callId: "call_read_err",
		toolName: "read",
		args: { path: "packages/core/src/missing.ts" },
		buildResult: () =>
			toolResultMessage(
				"call_read_err",
				"read",
				[textContent("[Error: ENOENT: no such file or directory, open 'packages/core/src/missing.ts']")],
				{ truncation: { truncated: false } },
				true,
			),
		wait,
		runningMs: T.toolRunning,
		isError: true,
	});
	await wait(T.phaseGap);

	// === Фінал: streaming-markdown підсумок ===
	const summary = md(
		"# Готово ✅",
		"",
		"Допоміг розібратись з проектом та додав фічу. Ось підсумок виконаної роботи:",
		"",
		"## Що зроблено",
		"",
		"- 📁 Вивчив структуру монорепо (`ls`, `read`)",
		"- 🔍 Знайшов ключові визначення (`grep`, `find`)",
		"- ✏️ Відредагував `packages/core/src/index.ts` (див. диф)",
		"- 📝 Створив `packages/core/src/utils.ts` (новий утилітний модуль)",
		"- 🔨 Перевірив білд — *усе проходить*",
		"",
		"## Зміни",
		"",
		"| Файл | Дія | Статус |",
		"|------|-----|--------|",
		"| `packages/core/src/index.ts` | edit | ✅ |",
		"| `packages/core/src/utils.ts` | create | ✅ |",
		"| `packages/core/src/missing.ts` | read | ❌ ENOENT |",
		"",
		"> Функція `uid()` доступна через `import { uid } from \"@coudycode/core\"`.",
		"",
		"Деталі — у [репозиторії](https://github.com/coinloger/coudy).",
	);
	await streamAssistantMessage(emit, [{ type: "text", text: summary }], streamOpts);

	const finalMessages: AgentMessage[] = [userMessage];
	emit({ type: "turn_end", message: userMessage, toolResults: [] });
	emit({ type: "agent_end", messages: finalMessages });
}
