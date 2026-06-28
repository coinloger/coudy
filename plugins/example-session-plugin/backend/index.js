/**
 * Example Session Plugin — backend entry.
 *
 * ДЕМО PLUGIN-OWNED ІЗОЛЬОВАНОЇ СЕСІЇ (declareSession).
 *
 * На відміну від tools:register/prompt:system (глобальні хуки), declareSession
 * створює ІЗОЛЬОВАНУ сесію: її тулзи/промпт/contextProvider застосовуються
 * СТРУКТУРНО лише в цій сесії і НІКОЛИ не потрапляють у глобальний HookEngine.
 *
 * У звичайному чаті (не plugin-сесії) інструмент «echo» і контекст НЕ зʾявляються.
 *
 * ctx.declareSession({
 *   id, title, systemPrompt, tools, inheritBaseTools, contextProvider,
 * })
 *
 * Експортує PluginBackendModule: { activate(ctx), deactivate(ctx) }.
 */

// TypeBox для опису JSONSchema вхідних параметрів інструменту.
// @ts-expect-error — typebox у root node_modules; плагін працює в контексті сервера.
import { Type } from "typebox";

// --- Контракт інструменту «echo» (Лише для цієї plugin-сесії) ---

const echoSchema = Type.Object({
	text: Type.String({ description: "Текст, який агент хоче повторити (echo)" }),
});

/**
 * @param {string} toolCallId
 * @param {{ text?: string }} params
 * @returns {Promise<{ content: { type: "text"; text: string }[]; details: unknown }>}
 */
async function executeEcho(toolCallId, params) {
	const text = params?.text ?? "";
	return {
		content: [{ type: "text", text: `ECHO: ${text}` }],
		details: { echoed: text, length: text.length },
	};
}

const echoTool = {
	name: "echo",
	description: "Повторює переданий текст (echo). Демо-інструмент plugin-сесії.",
	parameters: echoSchema,
	label: "Echo (plugin)",
	execute: executeEcho,
};

// --- contextProvider: живий фід контексту (кожен хід) ---
// Повертає обʼєкт → буде серіалізований у <plugin_context>…</plugin_context> в
// systemPrompt цього ходу. Дані свіжі кожен хід.
async function contextProvider() {
	// У реальному плагін тут був би fetch портфеля/цін/тощо. Для демо — час + лічильник.
	return {
		source: "example-session-plugin",
		serverTime: new Date().toISOString(),
		note: "Цей контекст впроваджується лише у plugin-сесії «echo-demo», не в глобальному чаті.",
		availableTool: "echo",
	};
}

export function activate(ctx) {
	ctx.utils.log("активовано (example-session-plugin)");

	// Декларувати ізольовану сесію: власний промпт + тулз echo + contextProvider.
	// inheritBaseTools = true → + read/bash/fetch (агент може читати файли).
	// Цей конфіг НЕ реєструється в глобальному HookEngine → не витікає.
	ctx.declareSession({
		id: "echo-demo",
		title: "Echo Demo (plugin session)",
		systemPrompt:
			"Ти — демо-асистент plugin-сесії «echo-demo». У тебе є інструмент «echo» — виклич його для повторення тексту. Відповідай українською, стисло.",
		tools: [echoTool],
		inheritBaseTools: true,
		contextProvider,
	});
}

export function deactivate(ctx) {
	ctx.utils.log("деактивовано (example-session-plugin)");
}
