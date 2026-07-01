/**
 * Тег-парсер Hermes/Qwen для локальних моделей (ornith тощо).
 *
 * Деякі локальні моделі випускають tool-виклики та reasoning текстовими тегами
 * замість native API:
 *   <think>REASONING</think>          → reasoning-блок
 *   <tool_call>                        → tool-виклик
 *     <function=NAME>...</function>
 *     <parameter=KEY>VALUE</parameter>
 *   </tool_call>
 * Або JSON-варіант: <tool_call>{"name":"X","arguments":{...}}</tool_call>
 *
 * Парсер — скінченний автомат над потоком дельт: розгалужує вхід на
 * text / thinking / toolCall фрагменти, стрипає теги, коректно обробляє
 * теги розрізані по дельтах (буферизує невизначений хвіст).
 * Вкладеність: <tool_call> всередині <think> витягується окремо; залишок
 * <think> (мінус tool_call) → reasoning.
 *
 * always-on, але no-op коли тегів немає (безпечно для native API моделей).
 */

/** Нормалізований фрагмент, який продюсить парсер. */
export type TagChunk =
	| { type: "text"; text: string }
	| { type: "thinking"; text: string }
	| { type: "toolCall"; name: string; arguments: Record<string, unknown> };

type Mode = "text" | "think" | "toolcall";

/** Лічильник для генерації id tool-callʼів (унікальних у межах відповіді). */
let toolCallCounter = 0;
export function nextToolCallId(): string {
	toolCallCounter += 1;
	return `tagcall_${Date.now().toString(36)}_${toolCallCounter}`;
}

export class TagStreamParser {
	private buffer = "";
	private mode: Mode = "text";
	/** Буфер контенту всередині режиму (think/toolcall), мінус теги. */
	private contentBuffer = "";
	/** Накопичений XML-контент поточного <tool_call> для розбору function/parameters. */
	private toolCallXml = "";
	/** Чи був <tool_call> відкритий з <think> (повернутись у think після закриття). */
	private toolCallFromThink = false;

	/** Подати чергову дельту сирого тексту → нормалізовані фрагменти. */
	feed(delta: string): TagChunk[] {
		this.buffer += delta;
		return this.drain();
	}

	/** Завершити потік: фіналізувати незакриті режими. */
	flush(): TagChunk[] {
		const chunks: TagChunk[] = [];
		// Дотиснути залишок буфера (незакритий тег → текст як є, мінус теги).
		const drained = this.drainFinal();
		chunks.push(...drained);
		if (this.contentBuffer.length > 0) {
			if (this.mode === "think") chunks.push({ type: "thinking", text: this.contentBuffer });
			else if (this.mode === "text") chunks.push({ type: "text", text: this.contentBuffer });
			this.contentBuffer = "";
		}
		// Незакритий <tool_call> — спробувати розібрати що є.
		if (this.mode === "toolcall" && this.toolCallXml.trim()) {
			const tc = parseToolCallXml(this.toolCallXml);
			if (tc) chunks.push({ type: "toolCall", ...tc });
		}
		this.mode = "text";
		this.buffer = "";
		this.toolCallXml = "";
		return chunks;
	}

	private drain(): TagChunk[] {
		const chunks: TagChunk[] = [];
		// Обробляти поки є визначений прогрес.
		let progress = true;
		while (progress) {
			progress = false;
			const before = this.buffer;

			if (this.mode === "text") {
				const r = this.drainText();
				chunks.push(...r);
			} else if (this.mode === "think") {
				const r = this.drainThink();
				chunks.push(...r);
			} else {
				const r = this.drainToolCall();
				chunks.push(...r);
			}
			if (this.buffer !== before) progress = true;
		}
		return chunks;
	}

	/** Фіналізація: поводитись з буфером як із завершеним (без чекання закриття тегів). */
	private drainFinal(): TagChunk[] {
		const chunks: TagChunk[] = [];
		const rest = this.buffer;
		this.buffer = "";
		if (rest.length === 0) return chunks;

		if (this.mode === "text") {
			// Стрипнути можливі залишкові/непарні теги, решту → text.
			const cleaned = stripTags(rest);
			if (cleaned) chunks.push({ type: "text", text: cleaned });
		} else if (this.mode === "think") {
			const cleaned = stripTags(rest);
			if (cleaned) this.contentBuffer += cleaned;
		} else {
			// toolcall: додати залишок у xml і дати розбору у flush().
			this.toolCallXml += rest;
		}
		return chunks;
	}

	/** Режим text: шукаємо <think> або <tool_call>; до них — text.
	 *  Стрипнути непарні закриваючі теги (</think>/</tool_call> витоку). */
	private drainText(): TagChunk[] {
		const chunks: TagChunk[] = [];
		// Спершу прибрати непарні закриваючі теги (витік моделі без відкриваючого).
		const closeThink = this.buffer.indexOf("</think>");
		const closeTc = this.buffer.indexOf("</tool_call>");
		let firstClose = -1;
		if (closeThink !== -1 && (closeTc === -1 || closeThink < closeTc)) firstClose = closeThink;
		else if (closeTc !== -1) firstClose = closeTc;
		const thinkIdx = this.buffer.indexOf("<think>");
		const tcIdx = this.buffer.indexOf("<tool_call>");
		// Перший тег (якщо є).
		let target = -1;
		let targetIs: "think" | "toolcall" | null = null;
		if (thinkIdx !== -1 && (tcIdx === -1 || thinkIdx < tcIdx)) {
			target = thinkIdx;
			targetIs = "think";
		} else if (tcIdx !== -1) {
			target = tcIdx;
			targetIs = "toolcall";
		}
		// Якщо закриваючий тег перед відкриваючим (або взагалі без відкриваючого) — стрипнути.
		if (firstClose !== -1 && (target === -1 || firstClose < target)) {
			const closeTag = closeThink === firstClose ? "</think>" : "</tool_call>";
			const before = this.buffer.slice(0, firstClose);
			if (before) chunks.push({ type: "text", text: before });
			this.buffer = this.buffer.slice(firstClose + closeTag.length);
			return chunks;
		}

		if (target === -1) {
			// Тегу поки нема. Можливо буфер містить неповний початок тегу ('<', '<th', ...).
			// Зберегти потенційний префікс '<' у буфер, решту — text.
			const lt = this.buffer.lastIndexOf("<");
			if (lt !== -1) {
				const candidate = this.buffer.slice(lt);
				if (couldBeTagStart(candidate)) {
					// Може бути початком тегу — залишити в буфері.
					const safe = this.buffer.slice(0, lt);
					if (safe) chunks.push({ type: "text", text: safe });
					this.buffer = candidate;
					return chunks;
				}
			}
			// Немає потенційного тегу — все text.
			if (this.buffer) chunks.push({ type: "text", text: this.buffer });
			this.buffer = "";
			return chunks;
		}

		// Є тег: text до нього.
		const before = this.buffer.slice(0, target);
		if (before) chunks.push({ type: "text", text: before });
		if (targetIs === "think") {
			this.buffer = this.buffer.slice(target + "<think>".length);
			this.mode = "think";
			this.contentBuffer = "";
		} else {
			this.buffer = this.buffer.slice(target + "<tool_call>".length);
			this.mode = "toolcall";
			this.toolCallXml = "";
			this.toolCallFromThink = false;
		}
		return chunks;
	}

	/** Режим think: шукаємо </think> або вкладений <tool_call>; контент → thinking. */
	private drainThink(): TagChunk[] {
		const chunks: TagChunk[] = [];
		const endIdx = this.buffer.indexOf("</think>");
		const tcIdx = this.buffer.indexOf("<tool_call>");

		// </think> має пріоритет лише якщо раніше/немає tool_call.
		if (endIdx !== -1 && (tcIdx === -1 || endIdx < tcIdx)) {
			const content = this.buffer.slice(0, endIdx);
			if (content) {
				this.contentBuffer += content;
				chunks.push({ type: "thinking", text: content });
			}
			this.buffer = this.buffer.slice(endIdx + "</think>".length);
			this.mode = "text";
			this.contentBuffer = "";
			return chunks;
		}

		// Вкладений <tool_call> всередині <think>.
		if (tcIdx !== -1) {
			const content = this.buffer.slice(0, tcIdx);
			if (content) {
				this.contentBuffer += content;
				chunks.push({ type: "thinking", text: content });
			}
			this.buffer = this.buffer.slice(tcIdx + "<tool_call>".length);
			this.mode = "toolcall";
			this.toolCallXml = "";
			this.toolCallFromThink = true;
			this.contentBuffer = "";
			return chunks;
		}

		// Жодного тегу поки. Зберегти потенційний початок закриття/вкладеності в буфер.
		const lt = this.buffer.lastIndexOf("<");
		if (lt !== -1) {
			const candidate = this.buffer.slice(lt);
			if (couldBeTagStart(candidate)) {
				const safe = this.buffer.slice(0, lt);
				if (safe) {
					this.contentBuffer += safe;
					chunks.push({ type: "thinking", text: safe });
				}
				this.buffer = candidate;
				return chunks;
			}
		}
		if (this.buffer) {
			this.contentBuffer += this.buffer;
			chunks.push({ type: "thinking", text: this.buffer });
		}
		this.buffer = "";
		return chunks;
	}

	/** Режим toolcall: шукаємо </tool_call>; накопичуємо XML. */
	private drainToolCall(): TagChunk[] {
		const endIdx = this.buffer.indexOf("</tool_call>");
		if (endIdx === -1) {
			// Можливо часткове закриття — зберегти потенційний префікс.
			const lt = this.buffer.lastIndexOf("<");
			if (lt !== -1) {
				const candidate = this.buffer.slice(lt);
				if (couldBeTagStart(candidate)) {
					this.toolCallXml += this.buffer.slice(0, lt);
					this.buffer = candidate;
					return [];
				}
			}
			this.toolCallXml += this.buffer;
			this.buffer = "";
			return [];
		}
		// </tool_call> знайдено.
		this.toolCallXml += this.buffer.slice(0, endIdx);
		this.buffer = this.buffer.slice(endIdx + "</tool_call>".length);
		const chunks: TagChunk[] = [];
		const tc = parseToolCallXml(this.toolCallXml);
		if (tc) chunks.push({ type: "toolCall", ...tc });
		this.toolCallXml = "";
		// Після tool_call: якщо були в think — лишаємось у think, інакше text.
		this.mode = this.toolCallFromThink ? "think" : "text";
		this.toolCallFromThink = false;
		return chunks;
	}
}

/** Чи може рядок бути початком тегу (неповним: '<', '<t', '</th', ...). */
function couldBeTagStart(s: string): boolean {
	if (!s.startsWith("<")) return false;
	const known = ["<think>", "</think>", "<tool_call>", "</tool_call>"];
	for (const tag of known) {
		if (tag.startsWith(s)) return true;
	}
	return false;
}

/** Видалити всі відомі теги з рядка (непарні/зайві). */
function stripTags(s: string): string {
	return s
		.replace(/<\/?think>/g, "")
		.replace(/<\/?tool_call>/g, "");
}

/** Розібрати XML-контент <function=NAME>...<parameter=KEY>VAL</parameter>...</function>
 *  або JSON {"name":..,"arguments":{..}}. */
export function parseToolCallXml(xml: string): { name: string; arguments: Record<string, unknown> } | null {
	const trimmed = xml.trim();
	if (!trimmed) return null;

	// JSON-варіант.
	if (trimmed.startsWith("{")) {
		try {
			const parsed = JSON.parse(trimmed) as { name?: string; arguments?: Record<string, unknown> };
			if (typeof parsed.name === "string") {
				return { name: parsed.name, arguments: parsed.arguments ?? {} };
			}
		} catch {
			/* не JSON — далі XML */
		}
	}

	// XML-варіант: <function=NAME> ... </function>
	const fnMatch = trimmed.match(/<function=([^>]+)>([\s\S]*?)<\/function>/);
	const name = fnMatch?.[1]?.trim();
	if (!name) return null;
	const body = fnMatch?.[2] ?? trimmed;

	const args: Record<string, unknown> = {};
	const paramRe = /<parameter=([^>]+)>([\s\S]*?)<\/parameter>/g;
	let m: RegExpExecArray | null;
	while ((m = paramRe.exec(body)) !== null) {
		const key = m[1]!.trim();
		const raw = m[2]!;
		args[key] = parseParamValue(raw);
	}
	return { name, arguments: args };
}

/** Значення параметра: спробувати JSON, інакше обрізаний string. */
function parseParamValue(raw: string): unknown {
	const trimmed = raw.trim();
	if (trimmed === "") return "";
	// JSON (масив/обʼєкт/число/булевий/null).
	if (trimmed.startsWith("[") || trimmed.startsWith("{") || trimmed.startsWith('"')) {
		try {
			return JSON.parse(trimmed);
		} catch {
			/* не валідний JSON — як string */
		}
	}
	if (trimmed === "true") return true;
	if (trimmed === "false") return false;
	if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
	return raw; // зберегти як є (з whitespace) для string-параметрів.
}

/**
 * TagChunkEmitter — інтеграція парсера в провайдера.
 *
 * Постачальник (provider) створює емітер з трьома колбеками:
 * - onText(text) — додати text-дельту (забезпечити text-блок).
 * - onThinking(text) — додати thinking-дельту (забезпечити thinking-блок).
 * - onToolCall(toolCall) — завершений toolCall (закрити поточний блок, створити toolCall-блок).
 * Емітер тримає TagStreamParser і делегує сирі дельти (text ЧИ reasoning) йому,
 * розганяючи результат у колбеки. На завершення (flush) — фіналізувати.
 */
export interface TagEmitterCallbacks {
	onText: (text: string) => void;
	onThinking: (text: string) => void;
	onToolCall: (toolCall: { id: string; name: string; arguments: Record<string, unknown> }) => void;
	/** Генерувати id для toolCallʼів (унікальні). */
	nextToolCallId?: () => string;
}

export class TagChunkEmitter {
	private parser = new TagStreamParser();
	private readonly cb: TagEmitterCallbacks;
	private readonly idGen: () => string;

	constructor(callbacks: TagEmitterCallbacks) {
		this.cb = callbacks;
		this.idGen = callbacks.nextToolCallId ?? nextToolCallId;
	}

	/** Подати дельту (text або reasoning). */
	feed(delta: string): void {
		const chunks = this.parser.feed(delta);
		this.dispatch(chunks);
	}

	/** Завершити потік. */
	flush(): void {
		const chunks = this.parser.flush();
		this.dispatch(chunks);
	}

	private dispatch(chunks: TagChunk[]): void {
		for (const chunk of chunks) {
			if (chunk.type === "text") {
				if (chunk.text) this.cb.onText(chunk.text);
			} else if (chunk.type === "thinking") {
				if (chunk.text) this.cb.onThinking(chunk.text);
			} else {
				this.cb.onToolCall({ id: this.idGen(), name: chunk.name, arguments: chunk.arguments });
			}
		}
	}
}

/** Перевірка, чи містить текст потенційні тег-маркери (для skip-оптимізації в провайдері). */
export function hasTagMarkers(text: string): boolean {
	return text.includes("<think") || text.includes("<tool_call");
}
