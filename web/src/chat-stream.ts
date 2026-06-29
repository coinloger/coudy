import type { AgentEvent } from "@coudycode/agent-core";
import type { ImageContent } from "@coudycode/ai";

/** Параметри SSE-запиту /api/chat. */
export interface ChatStreamOptions {
	sessionId: string;
	message: string;
	signal?: AbortSignal;
	images?: ImageContent[];
}

/** Парсити SSE-рядок «data: {json}» → обʼєкт події (або null). */
function parseEvent(line: string): AgentEvent | null {
	if (!line.startsWith("data: ")) return null;
	const raw = line.slice(6).trim();
	if (!raw) return null;
	try {
		return JSON.parse(raw) as AgentEvent;
	} catch {
		return null;
	}
}

/**
 * Запустити чат через SSE: POST /api/chat {sessionId, message} → стрім AgentEvent.
 * onEvent викликається для кожної події; onDone — після завершення стріму.
 */
export async function streamChat(
	options: ChatStreamOptions,
	onEvent: (event: AgentEvent) => void,
): Promise<void> {
	const res = await fetch("/api/chat", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			sessionId: options.sessionId,
			message: options.message,
			images: options.images,
		}),
		signal: options.signal,
	});

	if (!res.ok || !res.body) {
		throw new Error(`HTTP ${res.status}`);
	}

	const reader = res.body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";

	// eslint-disable-next-line no-constant-condition
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		buffer += decoder.decode(value, { stream: true });

		// SSE-події розділені порожнім рядком (\n\n). Обробляємо завершені рядки.
		let idx: number;
		while ((idx = buffer.indexOf("\n\n")) !== -1) {
			const block = buffer.slice(0, idx);
			buffer = buffer.slice(idx + 2);
			for (const line of block.split("\n")) {
				const event = parseEvent(line);
				if (event) onEvent(event);
			}
		}
	}

	// Обробити залишок буфера.
	if (buffer.trim()) {
		for (const line of buffer.split("\n")) {
			const event = parseEvent(line);
			if (event) onEvent(event);
		}
	}
}
