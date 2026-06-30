/**
 * Logic Block — Крок A (механіка + enforcement).
 *
 * Блок = пара маркер-тулзів (`block_start`/`block_end`), що обгортає регіон викликів
 * тулзів. Модель змушена працювати через блоки: на верхньому рівні (поза блоком)
 * доступний ЛИШЕ `block_start`; усі реальні тулзи — лише всередині відкритого блоку;
 * `block_end` закриває блок і записує підсумок (для компакції в Кроці B).
 *
 * Компакція context-builder у цьому кроці НЕ робиться (сирий I/O лишається в контексті).
 */

import { Type } from "typebox";
import type { AgentTool, AgentToolResult } from "./types.ts";

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
					{ type: "text", text: `Блок відкрито: ${holder.current.goal}\nВиконуй роботу інструментами всередині блоку, потім закрий block_end з ретельним підсумком.` },
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
			const summary = (params?.summary ?? "").toString().trim();
			const metadata: BlockMetadata = {
				blockId: block.id,
				startCallId: block.startCallId,
				endCallId: toolCallId,
				goal: block.goal,
				summary: summary || "(порожній підсумок)",
				sources: Array.isArray(params?.sources) ? params.sources!.filter((s) => typeof s === "string") : undefined,
				filesTouched: Array.isArray(params?.filesTouched)
					? params.filesTouched!.filter((f) => typeof f === "string")
					: undefined,
			};
			writer.writeBlock(metadata);
			holder.current = null;
			return {
				content: [{ type: "text", text: "Блок закрито. Підсумок збережено." }],
				details: { closed: true, blockId: block.id },
			};
		},
	};
}

export const BLOCK_TOOL_NAMES = ["block_start", "block_end"] as const;
