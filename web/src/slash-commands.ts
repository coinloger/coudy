/**
 * Slash-команди чату: реєстр {name, description} + диспетчер.
 * `/compact`, `/new` (alias `/clear`), `/help`, `/settings`, `/library`,
 * `/model`, `/copy`. Вводяться як звичайне повідомлення що починається з "/".
 */
import type { ImageContent } from "@coudycode/ai";

export interface SlashCommandContext {
	/** Текст після "/command ". */
	args: string;
	/** id поточної сесії. */
	sessionId: string;
	/** Почати стрім повідомлення в агента. */
	startStream: (msg: string, imgs: ImageContent[]) => void;
	/** Ручна компактація контексту. */
	onCompact: () => void;
	/** Створити новий чат. */
	onNewChat: () => void;
	/** Відкрити модалку налаштувань чату. */
	onOpenSettings: () => void;
	/** Відкрити вибір моделі. */
	onOpenModelSelector: () => void;
	/** Перехід за маршрутом. */
	navigate: (path: string) => void;
	/** Скопіювати останню відповідь агента в буфер. */
	copyLastAssistant: () => void;
	/** Показати toast (напр. /help, помилки). */
	toast: (msg: string) => void;
}

export interface SlashCommand {
	/** Імʼя без "/" (напр. "compact"). */
	name: string;
	/** Короткий опис для /help та автодоповнення. */
	description: string;
	/** Альтернативні імена (напр. /new → /clear). */
	aliases?: string[];
	/** Виконати команду. */
	run: (ctx: SlashCommandContext) => void;
}

function helpText(): string {
	const lines = BUILTIN_SLASH_COMMANDS.map((c) => `/${c.name} — ${c.description}`);
	return `Slash-команди:\n${lines.join("\n")}`;
}

/** Вбудовані slash-команди. */
export const BUILTIN_SLASH_COMMANDS: SlashCommand[] = [
	{ name: "compact", description: "Стиснути контекст сесії", run: (c) => c.onCompact() },
	{
		name: "new",
		aliases: ["clear"],
		description: "Новий чат",
		run: (c) => c.onNewChat(),
	},
	{ name: "help", description: "Показати список команд", run: (c) => c.toast(helpText()) },
	{ name: "settings", description: "Налаштування чату", run: (c) => c.onOpenSettings() },
	{
		name: "library",
		description: "Відкрити бібліотеку функцій",
		run: (c) => c.navigate("/library"),
	},
	{ name: "model", description: "Вибрати модель", run: (c) => c.onOpenModelSelector() },
	{
		name: "copy",
		description: "Копіювати останню відповідь агента",
		run: (c) => c.copyLastAssistant(),
	},
];

/**
 * Розібрати рядок у slash-команду. Повертає null, якщо рядок не починається з "/".
 * Невідома команда (без збігу) → null (викликач показує toast).
 */
export function findSlashCommand(
	raw: string,
): { command: SlashCommand; args: string } | null {
	const text = raw.trim();
	if (!text.startsWith("/")) return null;
	const spaceIdx = text.indexOf(" ");
	const name = spaceIdx === -1 ? text.slice(1) : text.slice(1, spaceIdx);
	const args = spaceIdx === -1 ? "" : text.slice(spaceIdx + 1);
	const cmd = BUILTIN_SLASH_COMMANDS.find((c) => c.name === name || c.aliases?.includes(name));
	return cmd ? { command: cmd, args } : null;
}
