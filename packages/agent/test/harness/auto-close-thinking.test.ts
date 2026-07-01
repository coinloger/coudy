import { fauxAssistantMessage, fauxToolCall, registerFauxProvider } from "@coudycode/ai";
import { afterEach, describe, expect, it } from "vitest";
import { AgentHarness } from "../../src/harness/agent-harness.ts";
import { NodeExecutionEnv } from "../../src/harness/env/nodejs.ts";
import { InMemorySessionStorage } from "../../src/harness/session/memory-storage.ts";
import { Session } from "../../src/harness/session/session.ts";

const registrations: { unregister: () => void }[] = [];

afterEach(() => {
	for (const r of registrations.splice(0)) r.unregister();
});

interface Msg {
	role: string;
	content: { type: string; text?: string; thinking?: string; name?: string }[];
}

async function branchMessages(harness: AgentHarness): Promise<Msg[]> {
	const branch = await (harness as unknown as { session: { getBranch: () => Promise<Array<{ message?: Msg }>> } }).session.getBranch();
	return branch.map((e) => e.message).filter((m): m is Msg => !!m);
}

/**
 * СЦЕНАРІЙ 1 (баг «відповідь застрягла в блоці»): первинний цикл — модель відкриває
 * block_start, продовжує після виконання тулза й пише фінальну відповідь текстом
 * УСЕРЕДИНІ блоку, зупиняється (без block_end). Auto-close → continuation → модель
 * доставляє фінальну відповідь користувачу текстом ПІСЛЯ блоку.
 */
it("auto-close → continuation: фінальна відповідь доставляється після блоку", async () => {
	const registration = registerFauxProvider();
	registrations.push(registration);

	// Первинний цикл: №1 block_start → №2 «відповідь у блоці» (stop, блок відкритий).
	// Continuation: №3 «відповідь після блоку».
	registration.setResponses([
		fauxAssistantMessage([fauxToolCall("block_start", { goal: "дослідити інтеграцію" })], { stopReason: "stop" }),
		fauxAssistantMessage("Це текст усередині блоку (застряг)."),
		fauxAssistantMessage("Ось як правильно інтегрувати після блоку."),
	]);

	const harness = new AgentHarness({
		env: new NodeExecutionEnv({ cwd: process.cwd() }),
		session: new Session(new InMemorySessionStorage()),
		model: registration.getModel(),
		logicBlocks: true,
		tools: [],
	});

	const result = await harness.prompt("як правильно інтегрувати?");
	// Фінальна відповідь — continuation (після блоку), не застрягла в блоці.
	expect(result.content.some((c) => c.type === "text" && c.text.includes("Ось як правильно інтегрувати після блоку"))).toBe(true);

	const messages = await branchMessages(harness);

	// Авто-закриття сталось: синтетичний block_end-маркер.
	const blockEndMarkers = messages.filter(
		(m) => m.role === "assistant" && m.content.some((c) => c.type === "toolCall" && c.name === "block_end"),
	);
	expect(blockEndMarkers.length).toBe(1);

	// Continuation-відповідь присутня як звичайне assistant-повідомлення.
	const contAnswers = messages.filter(
		(m) => m.role === "assistant" && m.content.some((c) => c.type === "text" && c.text?.includes("Ось як правильно інтегрувати після блоку")),
	);
	expect(contAnswers.length).toBe(1);

	// Continuation не зациклився: лише 1 block_start.
	const blockStarts = messages.filter(
		(m) => m.role === "assistant" && m.content.some((c) => c.type === "toolCall" && c.name === "block_start"),
	);
	expect(blockStarts.length).toBe(1);

	// Last-resort нота (thinking) НЕ додавалась — continuation спрацював.
	const notes = messages.filter(
		(m) => m.role === "assistant" && m.content.some((c) => c.type === "thinking" && c.thinking?.includes("авто-закриття")),
	);
	expect(notes.length).toBe(0);
});

/**
 * СЦЕНАРІЙ 2 (last-resort / бюджет): модель щоразу відкриває новий блок і зупиняється
 * з текстом (ніколи не закриває й не відповідає по-справжньому). Бюджет continuation (2)
 * вичерпується → last-resort: авто-закриття з нотою (thinking) + хід завершується.
 */
it("auto-close бюджет: вичерпання → last-resort з нотою, без циклу", async () => {
	const registration = registerFauxProvider();
	registrations.push(registration);

	// Первинний + 2 continuation: кожен = block_start → текст (блок відкритий, stop).
	// Після 2 continuation бюджет вичерпано → last-resort з нотою.
	registration.setResponses([
		fauxAssistantMessage([fauxToolCall("block_start", { goal: "задача" })], { stopReason: "stop" }),
		fauxAssistantMessage("текст у блоці 1"),
		fauxAssistantMessage([fauxToolCall("block_start", { goal: "задача" })], { stopReason: "stop" }),
		fauxAssistantMessage("текст у блоці 2"),
		fauxAssistantMessage([fauxToolCall("block_start", { goal: "задача" })], { stopReason: "stop" }),
		fauxAssistantMessage("текст у блоці 3"),
	]);

	const harness = new AgentHarness({
		env: new NodeExecutionEnv({ cwd: process.cwd() }),
		session: new Session(new InMemorySessionStorage()),
		model: registration.getModel(),
		logicBlocks: true,
		tools: [],
	});

	await harness.prompt("зроби");

	const messages = await branchMessages(harness);

	// Первинний + 2 continuation = 3 block_start спроби (бюджет 2 → не нескінченно).
	const blockStarts = messages.filter(
		(m) => m.role === "assistant" && m.content.some((c) => c.type === "toolCall" && c.name === "block_start"),
	);
	expect(blockStarts.length).toBe(3);

	// Last-resort нота (thinking) додалась — бюджет вичерпано.
	const notes = messages.filter(
		(m) => m.role === "assistant" && m.content.some((c) => c.type === "thinking" && c.thinking?.includes("авто-закриття")),
	);
	expect(notes.length).toBe(1);

	// Контекст, що бачить модель, компактований: послідовності валідні
	// (внутрішні assistant зсередини авто-закритих блоків дропаються).
	const { compactBlockInternals, extractBlockRanges } = await import("../../src/logic-block.ts");
	const branch = await (harness as unknown as { session: { getBranch: () => Promise<Array<{ type: string; customType?: string; data?: unknown }>> } }).session.getBranch();
	const blocks = extractBlockRanges(branch);
	const compacted = compactBlockInternals(messages, blocks);
	const cRoles = compacted.map((m) => m.role);
	let cConsecutive = false;
	for (let i = 1; i < cRoles.length; i++) {
		if (cRoles[i] === cRoles[i - 1]) {
			cConsecutive = true;
			break;
		}
	}
	expect(cConsecutive).toBe(false);
});
