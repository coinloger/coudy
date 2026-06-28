/**
 * Example Plugin — frontend entry (TSX з JSX).
 *
 * Компілюється на льоті сервером через esbuild (loader tsx, jsxFactory
 * window.React.createElement) → браузер отримує ESM-JS. React береться з
 * глобального window.React (експонується головним бандлом), тож JSX працює
 * БЕЗ `import React` і без власної копії React у плагіні.
 *
 * Доводить усі фронт-фільтри: sidebar-item, dashboard-widget, route,
 * settings-tab, chat-panel, message-action.
 *
 * Експортує PluginFrontendModule: { activate(ctx), deactivate(ctx) }.
 */

const R = window.React;

export function activate(ctx: {
	utils: { log: (...a: unknown[]) => void };
	hooks: {
		addFilter: (name: string, fn: (v: unknown) => unknown) => void;
	};
}): void {
	ctx.utils.log("frontend активовано (TSX)");

	// --- Пункт сайдбару (ui:sidebar-items) ---
	ctx.hooks.addFilter("ui:sidebar-items", (items: unknown) => [
		...(items as unknown[]),
		{ id: "example", label: "Example Plugin", icon: "Star", routeId: "example" },
	]);

	// --- Картка дашборду (ui:dashboard-widgets) ---
	ctx.hooks.addFilter("ui:dashboard-widgets", (widgets: unknown) => [
		...(widgets as unknown[]),
		{
			id: "example-widget",
			title: "Example Plugin",
			render: () => (
				<p className="small text-muted mb-0">
					Цю картку додано демо-плагіном (TSX) через хук ui:dashboard-widgets.
				</p>
			),
		},
	]);

	// --- Сторінка модуля (ui:routes) ---
	ctx.hooks.addFilter("ui:routes", (routes: unknown) => [
		...(routes as unknown[]),
		{
			id: "example",
			label: "Example Plugin",
			render: () => (
				<div className="p-4">
					<h2 className="h4 mb-3 text-primary">Example Plugin</h2>
					<p className="text-muted">
						Ця сторінка зареєстрована демо-плагіном (TSX з JSX) через хук ui:routes.
					</p>
					<div className="alert alert-success">
						TSX-компіляція працює: цей UI написаний на JSX і віддається як JS.
					</div>
				</div>
			),
		},
	]);

	// --- Таба налаштувань (ui:settings-tabs) ---
	ctx.hooks.addFilter("ui:settings-tabs", (tabs: unknown) => [
		...(tabs as unknown[]),
		{
			id: "example-settings",
			label: "Example",
			render: () => (
				<div className="cc-tab-placeholder">
					<p className="text-muted">
						Цю табу додано демо-плагіном (TSX) через хук ui:settings-tabs.
					</p>
					<div className="alert alert-success">Контент таби налаштувань від плагіна (JSX).</div>
				</div>
			),
		},
	]);

	// --- Панель чату (ui:chat-panel) ---
	ctx.hooks.addFilter("ui:chat-panel", (panels: unknown) => [
		...(panels as unknown[]),
		{
			id: "example-chat-panel",
			label: "Plugin info",
			render: () => (
				<div className="small text-muted mb-0">
					Панель чату від демо-плагіна (TSX) через хук ui:chat-panel.
				</div>
			),
		},
	]);

	// --- Дія на повідомленнях (ui:message-actions) ---
	ctx.hooks.addFilter("ui:message-actions", (actions: unknown) => [
		...(actions as unknown[]),
		{
			id: "example-echo",
			label: "Ехо",
			onClick: (message: { content?: unknown }) => {
				const content = message?.content;
				const text =
					typeof content === "string"
						? content
						: Array.isArray(content)
							? content.map((c: { text?: string }) => c?.text ?? "").join(" ")
							: "";
				ctx.utils.log("message-action Ехо (TSX):", text.slice(0, 60));
				window.alert("Ехо: " + text.slice(0, 200));
			},
		},
	]);
}

export function deactivate(ctx: { utils: { log: (...a: unknown[]) => void } }): void {
	ctx.utils.log("frontend деактивовано (TSX)");
}
