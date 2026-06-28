/**
 * Example Plugin — backend entry.
 * Доводить роботу бекенд-хуків: action (server:start) + filter (prompt:system).
 *
 * Експортує PluginBackendModule: { activate(ctx), deactivate(ctx) }.
 * ctx = { hooks, registry, utils: {log, error}, manifest, pluginPath }.
 */

export function activate(ctx) {
  ctx.utils.log("активовано");

  // --- Демонстрація бекенд action ---
  // Реагуємо на старт сервера. Реєструється ДО того, як сервер стріляє
  // server:start (плагіни вантажаться перед стартом HTTP), тож хук спрацює.
  ctx.hooks.addAction("server:start", () => {
    ctx.utils.log("сервер стартував — caught server:start action");
  });

  ctx.hooks.addAction("server:stop", () => {
    ctx.utils.log("сервер зупиняється — caught server:stop action");
  });

  // --- Демонстрація бекенд filter ---
  // Зарезервований фільтр системного промпту (поки не стріляє ядро,
  // але плагін готовий підписатись на трансформацію).
  ctx.hooks.addFilter("prompt:system", (prompt) => {
    return `${prompt}\n[example-plugin]: додаткові інструкції від демо-плагіна.`;
  });

  // --- Демонстрація HTTP-роутів (server:routes filter) ---
  // Плагін реєструє власні ендпоінти. ctx.handler отримує { req, res, sendJson,
  // sendError, readJsonBody }. При вимкненні плагіна (toggle) фільтр зникає
  // зі ScopedHookEngine → роут миттєво повертає 404.
  ctx.hooks.addFilter("server:routes", (routes) => {
    return [
      ...routes,
      {
        method: "GET",
        path: "/api/example-plugin/info",
        handler: ({ sendJson }) => {
          sendJson(200, {
            name: "example-plugin",
            time: new Date().toISOString(),
          });
        },
      },
      {
        method: "POST",
        path: "/api/example-plugin/echo",
        handler: async ({ sendJson, sendError, readJsonBody }) => {
          const body = await readJsonBody();
          if (!body || typeof body !== "object") {
            sendError(400, "Потрібне JSON-тіло");
            return;
          }
          sendJson(200, { echoed: body });
        },
      },
    ];
  });
}

export function deactivate(ctx) {
  ctx.utils.log("деактивовано");
}
