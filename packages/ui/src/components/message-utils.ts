import type { AgentMessage } from "@coudycode/agent-core";
import type { ImageContent, TextContent, ThinkingContent, ToolCall } from "@coudycode/ai";

/**
 * Витягнути з AgentMessage суто текст:
 * - user: content — рядок, або масив text-блоків (text join, '\n').
 * - assistant: content — масив, беруться лише text-блоки (thinking/tool-call ігноруються).
 * Повертає порожній рядок, якщо тексту нема.
 */
export function extractMessageText(message: AgentMessage): string {
	const content = (message as { content?: unknown }).content;
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.filter(
			(c): c is TextContent =>
				typeof c === "object" &&
				c !== null &&
				(c as { type?: unknown }).type === "text",
		)
		.map((c) => c.text)
		.join("\n");
}

/** Витягнути зображення (ImageContent[]) з content повідомлення (user). */
export function extractMessageImages(message: AgentMessage): ImageContent[] {
	const content = (message as { content?: unknown }).content;
	if (!Array.isArray(content)) return [];
	return content.filter(
		(c): c is ImageContent =>
			typeof c === "object" && c !== null && (c as { type?: unknown }).type === "image",
	);
}

// Допоміжний експорт типів для сумісності (щоб не імпортувати з двох місць).
export type { TextContent, ImageContent, ThinkingContent, ToolCall };
