/**
 * Logic Block — Крок A (механіка + enforcement) + Крок B (scoped compaction).
 *
 * Блок = пара маркер-тулзів (`block_start`/`block_end`), що обгортає регіон викликів
 * тулзів. Модель змушена працювати через блоки: на верхньому рівні (поза блоком)
 * доступний ЛИШЕ `block_start`; усі реальні тулзи — лише всередині відкритого блоку;
 * `block_end` закриває блок і записує підсумок.
 *
 * Крок B: для ЗАКРИТИХ блоків (минулі ходи) model-facing контекст компактується —
 * внутрішні toolCall'и + toolResult + проміжні thinking/text виключаються, лишається
 * лише goal+summary (власне block_start/block_end маркери з їхніми ack-result'ами).
 * Відкритий блок (поточний хід) НЕ компактується (live). JSONL не чіпається.
 */

import { Type } from "typebox";
import type { AgentMessage, AgentTool, AgentToolResult } from "./types.ts";

/** Стан відкритого блоку (живе в turn-лупі харнесу). */
export interface BlockState {
	/** Унікальний id блоку (== startCallId). */
	id: string;
	/** Опис задачі блоку (goal з block_start). */
	goal: string;
	/** toolCallId виклику block_start, що відкрив блок. */
	startCallId: string;
}

/** Метадані закритого блоку (записуються в сесію при block_end). */
export interface BlockMetadata {
	blockId: string;
	startCallId: string;
	endCallId: string;
	goal: string;
	summary: string;
	sources?: string[];
	filesTouched?: string[];
	/** true = блок закрито авто-закриттям (модель не викликала block_end). */
	autoClosed?: boolean;
}

/** Тип метаданих блоку в сесії (customType). */
export const BLOCK_CUSTOM_TYPE = "block";

/** Згортка стану блоку (mutable holder, щоб оновлювати з execute-замикань). */
export interface BlockHolder {
	/** Поточний відкритий блок або null (закритий). */
	current: BlockState | null;
}

/** Нова згортка стану блоку. */
export function createBlockHolder(): BlockHolder {
	return { current: null };
}

/** Згенерувати id блоку. */
function makeBlockId(): string {
	return `block-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Колбеки запису метаданих блоку в сесію (харнес реалізує через pendingSessionWrites). */
export interface BlockWriter {
	/** Записати метадані закритого блоку (примусово — блок закрито моделлю або auto-close). */
	writeBlock(metadata: BlockMetadata): void;
}

const goalSchema = Type.Object({
	goal: Type.String({ description: "Опис задачі цього блоку: що саме виконуєш інструментами всередині." }),
});
const endSchema = Type.Object({
	summary: Type.String({
		description:
			"Ретельний підсумок блоку. У майбутніх ходах у контексті лишається ТІЛЬКИ цей підсумок (сирий I/O викидатиметься), тож пиши як покажчик: що зроблено, які файли/знахідки, прийняті рішення.",
	}),
	sources: Type.Optional(Type.Array(Type.String(), { description: "URL-джерела (для web-пошуку), опц." })),
	filesTouched: Type.Optional(Type.Array(Type.String(), { description: "Файли, що змінено/прочитано, опц." })),
});

/**
 * Створити тулз `block_start`: відкриває блок.
 * Оновлює holder.current. Повертає короткий ack.
 */
export function createBlockStartTool(holder: BlockHolder): AgentTool<typeof goalSchema> {
	return {
		name: "block_start",
		label: "block_start",
		group: "core",
		description:
			"Відкрити логічний блок для виконання роботи інструментами. Позаблоком у тебе НЕМА прямих інструментів — лише цей маркер. " +
			"Виклич його з goal, потім виконуй потрібні інструменти (read/bash/grep/…), а завершуй block_end з ретельним підсумком. " +
			"Вкладеність заборонена: вже всередині блоку цей тулз недоступний.",
		parameters: goalSchema,
		async execute(toolCallId, params): Promise<AgentToolResult<unknown>> {
			const goal = (params?.goal ?? "").toString().trim();
			const id = makeBlockId();
			holder.current = { id, goal: goal || "(без опису)", startCallId: toolCallId };
			return {
				content: [
					{ type: "text", text: `Блок відкрито: ${holder.current.goal}\nВиконуй роботу інструментами всередині блоку, потім закрий block_end з ретельним підсумком — після чого відповідай користувачу текстом з цього підсумку.` },
				],
				details: { blockId: id, opened: true },
			};
		},
	};
}

/**
 * Створити тулз `block_end`: закриває блок, пише підсумок у сесію.
 * Очищає holder.current. Повертає ack.
 */
export function createBlockEndTool(holder: BlockHolder, writer: BlockWriter): AgentTool<typeof endSchema> {
	return {
		name: "block_end",
		label: "block_end",
		group: "core",
		description:
			"Закрити відкритий логічний блок з підсумком. Після цього блоковий доступ до інструментів закривається (знову лише block_start або текстова відповідь). " +
			"Підсумок має бути самодостатнім покажчиком (сирий I/O блоку викидатиметься з контексту в майбутніх ходах).",
		parameters: endSchema,
		async execute(toolCallId, params): Promise<AgentToolResult<unknown>> {
			const block = holder.current;
			if (!block) {
				return {
					content: [{ type: "text", text: "Немає відкритого блоку — block_end без block_start. Просто відповідай текстом." }],
					details: { closed: false, reason: "no_open_block" },
				};
			}
			const summary = (params?.summary ?? "").toString().trim() || "(порожній підсумок)";
			const metadata: BlockMetadata = {
				blockId: block.id,
				startCallId: block.startCallId,
				endCallId: toolCallId,
				goal: block.goal,
				summary,
				sources: Array.isArray(params?.sources) ? params.sources!.filter((s) => typeof s === "string") : undefined,
				filesTouched: Array.isArray(params?.filesTouched)
					? params.filesTouched!.filter((f) => typeof f === "string")
					: undefined,
			};
			writer.writeBlock(metadata);
			holder.current = null;
			return {
				content: [
					{
						type: "text",
						text: `Блок закрито. Підсумок: «${summary}».\nТепер дай відповідь користувачу, спираючись ЦІЛКОМ на цей підсумок — текстом, БЕЗ нового блоку (якщо питання не вимагає нової роботи).`,
					},
				],
				details: { closed: true, blockId: block.id },
			};
		},
	};
}

export const BLOCK_TOOL_NAMES = ["block_start", "block_end"] as const;

// ===== Крок B: scoped compaction у context-builder =====

/** Звужені метадані блоку, потрібні для компакції контексту. */
export interface BlockRange {
	startCallId: string;
	endCallId: string;
}

/**
 * Витягнути id всіх toolCall'ів із assistant-повідомлення (якщо це assistant).
 */
function assistantToolCallIds(msg: AgentMessage): string[] {
	if (typeof msg !== "object" || msg === null || (msg as { role?: string }).role !== "assistant") return [];
	const content = (msg as { content?: unknown }).content;
	if (!Array.isArray(content)) return [];
	return content
		.filter((c): c is { type: "toolCall"; id: string } =>
			typeof c === "object" && c !== null && (c as { type?: string }).type === "toolCall" && typeof (c as { id?: unknown }).id === "string")
		.map((c) => c.id);
}

/** Чи містить assistant-повідомлення toolCall із заданим id (маркер блоку)? */
function hasToolCallId(msg: AgentMessage, callId: string): boolean {
	return assistantToolCallIds(msg).includes(callId);
}

/** Витягнути склеєний текст із assistant-повідомлення (для best-effort summary). */
function lastAssistantText(msg: AgentMessage): string {
	if (typeof msg !== "object" || msg === null || (msg as { role?: string }).role !== "assistant") return "";
	const content = (msg as { content?: unknown }).content;
	if (!Array.isArray(content)) return "";
	return content
		.filter(
			(c): c is { type: "text"; text: string } =>
				typeof c === "object" &&
				c !== null &&
				(c as { type?: string }).type === "text" &&
				typeof (c as { text?: unknown }).text === "string",
		)
		.map((c) => c.text)
		.join("")
		.trim();
}

/**
 * Best-effort підсумок для auto-closed блоку: останній assistant-текст після block_start
 * (це готова відповідь моделі, яку вона написала, забувши закрити блок).
 * Якщо тексту нема → fallback.
 */
export function extractBlockSummary(messages: AgentMessage[], startCallId: string): string {
	let startIdx = -1;
	for (let i = 0; i < messages.length; i++) {
		if (hasToolCallId(messages[i]!, startCallId)) {
			startIdx = i;
			break;
		}
	}
	if (startIdx === -1) return "(роботу виконано, підсумок відсутній)";
	for (let i = messages.length - 1; i > startIdx; i--) {
		const text = lastAssistantText(messages[i]!);
		if (text) return text;
	}
	return "(роботу виконано, підсумок відсутній)";
}

/**
 * Прибрати внутрішності ЗАКРИТИХ блоків із model-facing контексту (Крок B).
 *
 * Для кожного блоку (startCallId → endCallId) виключаються повідомлення строго між
 * маркерами: проміжні assistant (thinking/text/internal toolCalls) + їхні toolResult.
 * Маркери block_start/block_end + їхні ack-result'и залишаються → модель бачить goal+summary.
 *
 * Відкритий блок (без endCallId / не в `blocks`) не компактується — залишається наживо.
 * JSONL не чіпається (транскрипт збережено) — фільтрація лише у вигляді контексту.
 *
 * API-валідність: дропаємо toolCall разом з його toolResult (за id), orphaned result не виникає.
 */
export function compactBlockInternals(messages: AgentMessage[], blocks: BlockRange[]): AgentMessage[] {
	if (blocks.length === 0) return messages;

	// 1. Знайти індекси маркерів кожного блоку + множину "внутрішніх" toolCallId.
	interface ResolvedBlock {
		startIdx: number;
		endIdx: number;
	}
	const resolved: ResolvedBlock[] = [];
	const internalCallIds = new Set<string>();

	for (const block of blocks) {
		let startIdx = -1;
		let endIdx = -1;
		for (let i = 0; i < messages.length; i++) {
			if (startIdx === -1 && hasToolCallId(messages[i]!, block.startCallId)) {
				startIdx = i;
				continue;
			}
			if (startIdx !== -1 && hasToolCallId(messages[i]!, block.endCallId)) {
				endIdx = i;
				break;
			}
		}
		if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx + 1) continue; // маркери не знайдені або порожній блок
		resolved.push({ startIdx, endIdx });
		// внутрішні toolCallId (асистентські повідомлення строго між маркерами)
		for (let i = startIdx + 1; i < endIdx; i++) {
			for (const id of assistantToolCallIds(messages[i]!)) internalCallIds.add(id);
		}
	}

	if (resolved.length === 0 && internalCallIds.size === 0) return messages;

	// 2. Допоміжна перевірка: повідомлення строго всередині будь-якого блоку.
	const isStrictlyInsideAnyBlock = (i: number): boolean =>
		resolved.some((b) => i > b.startIdx && i < b.endIdx);

	// 3. Відфільтрувати: дропати toolResult із внутрішнім toolCallId + дропати assistant всередині блоку
	//    (вони містять лише внутрішній контент; ack-result маркерів має startCallId/endCallId → не дропається).
	const result: AgentMessage[] = [];
	for (let i = 0; i < messages.length; i++) {
		const msg = messages[i]!;
		const role = (msg as { role?: string }).role;
		// toolResult з внутрішнім toolCallId → дропнути (парний до дропнутого toolCall).
		if (role === "toolResult" && internalCallIds.has((msg as { toolCallId: string }).toolCallId)) {
			continue;
		}
		// assistant-повідомлення строго всередині блоку → дропнути (внутрішній контент).
		if (role === "assistant" && isStrictlyInsideAnyBlock(i)) {
			continue;
		}
		result.push(msg);
	}
	return result;
}

/**
 * Дістати метадані ЗАКРИТИХ блоків із записів сесії (custom-entries customType:block).
 * Лише блоки з повною парою startCallId+endCallId (закриті).
 */
export function extractBlockRanges(
	entries: Array<{ type: string; customType?: string; data?: unknown }>,
): BlockRange[] {
	const ranges: BlockRange[] = [];
	for (const e of entries) {
		if (e.type !== "custom" || e.customType !== BLOCK_CUSTOM_TYPE) continue;
		const data = e.data as Partial<BlockMetadata> | undefined;
		if (data && typeof data.startCallId === "string" && typeof data.endCallId === "string") {
			ranges.push({ startCallId: data.startCallId, endCallId: data.endCallId });
		}
	}
	return ranges;
}
