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
}

export function deactivate(ctx) {
  ctx.utils.log("деактивовано");
}
