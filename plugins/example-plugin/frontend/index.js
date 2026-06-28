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

  // --- Таба налаштувань (ui:settings-tabs) ---
  ctx.hooks.addFilter("ui:settings-tabs", (tabs) => [
    ...tabs,
    {
      id: "example-settings",
      label: "Example",
      render: () =>
        R.createElement(
          "div",
          { className: "cc-tab-placeholder" },
          R.createElement(
            "p",
            { className: "text-muted" },
            "Цю табу додано демо-плагіном через хук ui:settings-tabs.",
          ),
          R.createElement(
            "div",
            { className: "alert alert-success" },
            "Контент таби налаштувань від плагіна.",
          ),
        ),
    },
  ]);

  // --- Панель чату (ui:chat-panel) ---
  ctx.hooks.addFilter("ui:chat-panel", (panels) => [
    ...panels,
    {
      id: "example-chat-panel",
      label: "Plugin info",
      render: () =>
        R.createElement(
          "div",
          { className: "small text-muted mb-0" },
          "Цю панель додано демо-плагіном через хук ui:chat-panel.",
        ),
    },
  ]);

  // --- Дія на повідомленнях (ui:message-actions) ---
  ctx.hooks.addFilter("ui:message-actions", (actions) => [
    ...actions,
    {
      id: "example-echo",
      label: "Ехо",
      onClick: (message) => {
        // Витягуємо текст повідомлення для демо.
        const text =
          typeof message.content === "string"
            ? message.content
            : Array.isArray(message.content)
              ? message.content
                  .map((c) => (c && c.text) || "")
                  .join(" ")
              : "";
        ctx.utils.log("message-action Ехо:", text.slice(0, 60));
        window.alert("Ехо: " + text.slice(0, 200));
      },
    },
  ]);
}

export function deactivate(ctx) {
  ctx.utils.log("frontend деактивовано");
}
