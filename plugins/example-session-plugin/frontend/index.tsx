/**
 * Example Session Plugin — frontend entry (TSX з JSX).
 *
 * Компілюється на льоту сервером (esbuild, jsxFactory window.React.createElement).
 * Реєструє сторінку (ui:routes), що вбудовує reusable PluginChatCanvas, вказуючи
 * на власну plugin-сесію «echo-demo» (декларовану в backend через declareSession).
 *
 * Валідація повного циклу: відкрити сторінку плагіна → чат → повідомлення →
 * агент відповідає в ізольованій сесії (тулз echo + contextProvider-фід).
 *
 * Експортує PluginFrontendModule: { activate(ctx), deactivate(ctx) }.
 */

const R = window.React;

export function activate(ctx) {
	ctx.utils.log("frontend активовано (example-session-plugin)");

	// --- Сторінка модуля (ui:routes) — чат на plugin-сесії «echo-demo» ---
	ctx.hooks.addFilter("ui:routes", (routes) => [
		...routes,
		{
			id: "example-session-plugin",
			label: "Echo Demo",
			render: () =>
				R.createElement(
					"div",
					{ className: "h-100" },
					R.createElement(window.coudy.PluginChatCanvas, {
						pluginName: "example-session-plugin",
						pluginSessionId: "echo-demo",
						title: "Echo Demo — plugin session",
					}),
				),
		},
	]);

	// --- Пункт сайдбару для швидкого доступу до сторінки ---
	ctx.hooks.addFilter("ui:sidebar-items", (items) => [
		...items,
		{ id: "example-session-plugin", label: "Echo Demo", icon: "MessageSquare", routeId: "example-session-plugin" },
	]);
}

export function deactivate(ctx) {
	ctx.utils.log("frontend деактивовано (example-session-plugin)");
}
