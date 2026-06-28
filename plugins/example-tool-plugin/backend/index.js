/**
 * Example Tool Plugin — backend entry.
 *
 * ДЕМО КОНТРАКТУ ПЛАГІННОГО ІНСТРУМЕНТУ (agent-tool).
 *
 * Плагін може додати власний інструмент агенту через filter «tools:register».
 * Контракт інструменту — AgentTool з @coudycode/agent-core:
 *   {
 *     name: string,                 // унікальне імʼя інструменту
 *     description: string,          // для LLM (що робить інструмент)
 *     parameters: TSchema,          // TypeBox-схема вхідних параметрів
 *     label: string,                // людяна назва для UI
 *     execute: (toolCallId, params, signal?, onUpdate?) => Promise<AgentToolResult>
 *   }
 *
 * AgentToolResult = { content: (TextContent|ImageContent)[], details: any, terminate? }
 *
 * Filter «tools:register» отримує поточний масив AgentTool[] → треба
 * ПОВЕРНУТИ новий масив (розширений). Filter «prompt:system» — рядок системного
 * промпту → треба повернути новий рядок.
 *
 * Експортує PluginBackendModule: { activate(ctx), deactivate(ctx) }.
 */

// TypeBox для опису JSONSchema вхідних параметрів інструменту.
// @ts-expect-error — typebox у root node_modules; плагін працює в контексті сервера.
import { Type, Static } from "typebox";

// --- Контракт інструменту «timestamp» ---

const timestampSchema = Type.Object({
	timezone: Type.Optional(
		Type.String({ description: "Опц. часовий пояс для IANA-timezone форматування (напр. Europe/Kyiv)" }),
	),
});

/**
 * @param {string} toolCallId
 * @param {{ timezone?: string }} params
 * @returns {Promise<{ content: { type: "text"; text: string }[]; details: unknown }>}
 */
async function executeTimestamp(toolCallId, params) {
	const tz = params?.timezone;
	let now;
	let formatted;
	try {
		now = new Date();
		formatted = tz
			? new Intl.DateTimeFormat("uk-UA", { dateStyle: "full", timeStyle: "long", timeZone: tz }).format(now)
			: now.toISOString();
	} catch {
		// Невалідний timezone → fallback на UTC ISO.
		now = new Date();
		formatted = now.toISOString();
	}
	return {
		content: [{ type: "text", text: `Поточний час: ${formatted}` }],
		details: { iso: now.toISOString(), timezone: tz ?? "UTC" },
	};
}

const timestampTool = {
	name: "timestamp",
	description:
		"Повертає поточний час (дата + час). Корисно, коли користувач питає який зараз час або дату.",
	parameters: timestampSchema,
	label: "Поточний час",
	execute: executeTimestamp,
};

export function activate(ctx) {
	ctx.utils.log("активовано (agent-tool-plugin)");

	// --- Filter: додати інструмент «timestamp» до агента ---
	ctx.hooks.addFilter("tools:register", (tools) => {
		return [...tools, timestampTool];
	});

	// --- Filter: доповнити системний промпт інструкцією про новий інструмент ---
	ctx.hooks.addFilter("prompt:system", (prompt) => {
		return (
			prompt +
			"\n\n[example-tool-plugin]: У тебе є інструмент «timestamp» — виклич його, коли користувач питає який зараз час або дата."
		);
	});

	// --- Демонстрація agent-action-ів ---
	ctx.hooks.addAction("agent:before-prompt", (session, message, model) => {
		ctx.utils.log(`agent:before-prompt: message=${JSON.stringify(message).slice(0, 60)}`);
	});

	ctx.hooks.addAction("agent:after-response", (session, model) => {
		ctx.utils.log("agent:after-response: відповідь завершено");
	});
}

export function deactivate(ctx) {
	ctx.utils.log("деактивовано (agent-tool-plugin)");
}
