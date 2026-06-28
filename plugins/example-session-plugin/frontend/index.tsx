/**
 * Example Session Plugin — frontend entry (TSX з JSX).
 *
 * Компілюється на льоту сервером (esbuild, jsxFactory window.React.createElement).
 * Доводить КОМПОЗИЦІЮ сторінки плагіна: конфіг-блок (Panel з інпутами) +
 * reusable PluginChatCanvas (обмежений height) поряд на одній сторінці.
 *
 * Чат вказує на власну plugin-сесію «echo-demo» (декларовану в backend через
 * declareSession) → /api/chat резолвить ownership → ізольований конфіг
 * (тулз echo + contextProvider-фід).
 *
 * Експортує PluginFrontendModule: { activate(ctx), deactivate(ctx) }.
 */

const R = window.React;

export function activate(ctx) {
	ctx.utils.log("frontend активовано (example-session-plugin)");

	// --- Сторінка модуля (ui:routes) — композиція: конфіг + чат ---
	ctx.hooks.addFilter("ui:routes", (routes) => [
		...routes,
		{
			id: "example-session-plugin",
			label: "Echo Demo",
			render: () =>
				// Bootstrap grid: ліва колонка — конфіг (Panel з інпутами),
				// права колонка — PluginChatCanvas (height 600px, не full-page).
				R.createElement(
					"div",
					{ className: "p-4" },
					R.createElement(
						"h2",
						{ className: "h4 mb-3 text-primary" },
						"Echo Demo — plugin session",
					),
					R.createElement(
						"p",
						{ className: "text-muted small mb-4" },
						"Сторінка плагіна: блок налаштування (Panel) + reusable чат (PluginChatCanvas) співіснують.",
					),
					R.createElement(
						"div",
						{ className: "row g-3" },
						// --- Ліва колонка: конфіг-блок ---
						R.createElement(
							"div",
							{ className: "col-md-4" },
							R.createElement(
								window.coudy.Panel,
								{ title: "Конфігурація" },
								R.createElement("div", { className: "mb-2" }, [
									R.createElement("label", { key: "l1", className: "form-label small" }, "Назва"),
									R.createElement("input", {
										key: "i1",
										type: "text",
										className: "form-control form-control-sm",
										placeholder: "напр. Моя підписка",
										defaultValue: "Echo config",
									}),
								]),
								R.createElement("div", { className: "mb-2" }, [
									R.createElement("label", { key: "l2", className: "form-label small" }, "Значення"),
									R.createElement("input", {
										key: "i2",
										type: "number",
										className: "form-control form-control-sm",
										defaultValue: "42",
									}),
								]),
								R.createElement(
									"div",
									{ className: "form-text small text-muted" },
									"Demo-форма. В реальному плагін тут був би конфіг, що живить contextProvider.",
								),
							),
						),
						// --- Права колонка: чат canvas (обмежений height) ---
						R.createElement(
							"div",
							{ className: "col-md-8" },
							R.createElement(window.coudy.PluginChatCanvas, {
								pluginName: "example-session-plugin",
								pluginSessionId: "echo-demo",
								title: "Echo chat",
								height: 600,
							}),
						),
					),
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
