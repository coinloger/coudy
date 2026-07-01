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

/**
 * Коли модель відкриває block_start але завершує хід БЕЗ block_end —
 * auto-close має записати 3-й синтетичний запис як thinking-блок (НЕ text),
 * щоб зауваження не було видиме в чаті юзера (reasoning приховано за замовч.).
 */
it("auto-close writes a thinking block (not text) so it is hidden from chat", async () => {
	const registration = registerFauxProvider();
	registrations.push(registration);

	// Хід 1: модель відкриває блок, відразу стоп (НЕ закриває) → auto-close.
	// Хід 2: проста відповідь (валідне чергування після авто-закриття).
	registration.setResponses([
		fauxAssistantMessage([fauxToolCall("block_start", { goal: "прочитати файл X" })], { stopReason: "stop" }),
		fauxAssistantMessage("Готово."),
	]);

	const harness = new AgentHarness({
		env: new NodeExecutionEnv({ cwd: process.cwd() }),
		session: new Session(new InMemorySessionStorage()),
		model: registration.getModel(),
		logicBlocks: true,
		tools: [],
	});

	await harness.prompt("прочитай файл X");

	// Перший хід → auto-close. Другий хід щоб переконатись що чергування валідне
	// (assistant-after-block перед наступним user).
	await harness.prompt("добре");

	const branch = await harness["session"].getBranch();
	const messages = branch.map((e) => (e as { message?: { role: string; content: { type: string; thinking?: string; text?: string }[] } }).message).filter(Boolean);

	// Знайти синтетичний запис auto-close: assistant з block_start вже є, шукаємо
	// assistant-повідомлення після block_end ack, що містить «авто-закриття».
	const autoCloseNotes = messages.filter(
		(m) =>
			m.role === "assistant" &&
			m.content.some((c) =>
				(c.type === "thinking" || c.type === "text") && (c.thinking ?? c.text ?? "").includes("авто-закриття"),
			),
	);
	expect(autoCloseNotes.length).toBeGreaterThanOrEqual(1);

	const note = autoCloseNotes[0];
	const block = note.content.find((c) => c.type === "thinking" || c.type === "text")!;
	// КЛЮЧОВА ПЕРЕВІРКА: тип контенту — thinking (НЕ text).
	expect(block.type).toBe("thinking");
	expect(block.thinking).toContain("авто-закриття");

	// Дисципліна лишається в контексті моделі.
	expect(block.thinking).toContain("ЗАКРИВАЙ");

	// Жодного assistant-text «⚠️...» (старий text-формат) — він мав би бути text.
	const oldTextStyle = messages.some(
		(m) => m.role === "assistant" && m.content.some((c) => c.type === "text" && c.text?.includes("авто-закриття")),
	);
	expect(oldTextStyle).toBe(false);
});
