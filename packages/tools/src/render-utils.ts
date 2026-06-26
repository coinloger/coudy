/**
 * Headless render-utils — текстові хелпери для execute-тіла інструментів.
 * Без TUI (Theme, hyperlinks, image-fallback rendering) — лише санітізація тексту.
 */

import * as os from "node:os";
import type { ImageContent, TextContent } from "@coudycode/ai";
import { stripAnsi } from "./utils/ansi.ts";
import { sanitizeBinaryOutput } from "./utils/shell.ts";

/** Скоротити абсолютний шлях до ~-відносного, якщо він у домашній директорії. */
export function shortenPath(path: unknown): string {
	if (typeof path !== "string") return "";
	const home = os.homedir();
	if (path.startsWith(home)) {
		return `~${path.slice(home.length)}`;
	}
	return path;
}

/**
 * Привести невідомий аргумент до рядка.
 * - рядок → як є
 * - null/undefined → порожній рядок (для рендеру)
 * - інакше → null (невалідний аргумент)
 */
export function str(value: unknown): string | null {
	if (typeof value === "string") return value;
	if (value == null) return "";
	return null;
}

/** Замінити табуляцію на пробіли (для стабільного відображення). */
export function replaceTabs(text: string): string {
	return text.replace(/\t/g, "   ");
}

/** Нормалізувати CR (прибрати \r). */
export function normalizeDisplayText(text: string): string {
	return text.replace(/\r/g, "");
}

/**
 * Headless renderToolPath — повертає скорочений шлях для відображення.
 * Без Theme/hyperlinks (на відміну від pi-донора).
 */
export function renderToolPath(
	rawPath: string | null,
	cwd: string,
	options?: { emptyFallback?: string },
): string {
	void cwd;
	if (rawPath === null) return "[invalid arg]";
	const value = rawPath || options?.emptyFallback;
	if (!value) return "...";
	return shortenPath(value);
}

/** Текстова позначка невалідного аргументу (headless, без Theme). */
export function invalidArgText(): string {
	return "[invalid arg]";
}

/**
 * Витягти текстовий вивід з результату інструменту (headless).
 * Збирає text-блоки, санітізує бінарний вміст та ANSI. Зображення не рендерить
 * (у web-контексті вони відображаються окремо), лише повертає текст.
 */
export function getTextOutput(
	result:
		| {
				content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
		  }
		| undefined,
	showImages: boolean,
): string {
	void showImages;
	if (!result) return "";
	const textBlocks = result.content.filter((c) => c.type === "text");
	return textBlocks
		.map((c) => sanitizeBinaryOutput(stripAnsi(c.text ?? "")).replace(/\r/g, ""))
		.join("\n");
}

export type ToolRenderResultLike<TDetails> = {
	content: (TextContent | ImageContent)[];
	details: TDetails;
};
