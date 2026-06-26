/**
 * Example Plugin — frontend entry.
 * Доводить роботу фронт-фільтрів: додає пункт сайдбару (над системним
 * футером), картку на дашборд та сторінку — БЕЗ жодних змін у ядрі.
 *
 * Експортує PluginFrontendModule: { activate(ctx), deactivate(ctx) }.
 * ctx = { hooks, registry, utils: {log, error}, manifest }.
 *
 * Валідний ES-модуль без JSX: UI будуємо через window.React.createElement
 * (React експонується головним бандлом додатку).
 */

const R = window.React;

export function activate(ctx) {
  ctx.utils.log("frontend активовано");

  // --- Пункт сайдбару від плагіна (над системним футером) ---
  ctx.hooks.addFilter("ui:sidebar-items", (items) => [
    ...items,
    { id: "example", label: "Example Plugin", icon: "Star", routeId: "example" },
  ]);

  // --- Картка на дашборді ---
  ctx.hooks.addFilter("ui:dashboard-widgets", (widgets) => [
    ...widgets,
    {
      id: "example-widget",
      title: "Example Plugin",
      render: () =>
        R.createElement(
          "p",
          { className: "small text-muted mb-0" },
          "Цю картку додано демо-плагіном через хук ui:dashboard-widgets. " +
            "Перейдіть у «Модулі» → «Example Module», щоб відкрити сторінку плагіна.",
        ),
    },
  ]);

  // --- Сторінка модуля (повна сторінка) ---
  ctx.hooks.addFilter("ui:routes", (routes) => [
    ...routes,
    {
      id: "example",
      label: "Example Plugin",
      render: () =>
        R.createElement(
          "div",
          { className: "p-4" },
          R.createElement(
            "h2",
            { className: "h4 mb-3 text-primary" },
            "Example Plugin",
          ),
          R.createElement(
            "p",
            { className: "text-muted" },
            "Ця сторінка зареєстрована демо-плагіном через хук ui:routes — " +
              "без жодних змін у ядрі coudycode.",
          ),
          R.createElement(
            "div",
            { className: "alert alert-success" },
            "Плагінна система працює: пункт сайдбару, картка дашборду та " +
              "сторінка розширюються з plugins/example-plugin.",
          ),
        ),
    },
  ]);
}

export function deactivate(ctx) {
  ctx.utils.log("frontend деактивовано");
}
