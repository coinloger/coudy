# ⚡ coudycode

**coudycode** — ядро вебзастосунку з WordPress-подібною плагінною системою
(hooks: **actions** та **filters**), що працює і на бекенді (Node.js/TypeScript),
і на фронтенді (Vite + React + Bootstrap). Ядро ізоморфне: один `HookEngine`
використовується і в сервері, і в браузері.

## Поточний стан

- ✅ **`packages/core`** — ізоморфний `HookEngine` (addAction/doAction,
  addFilter/applyFilters, пріоритети, async) + спільні типи (`PluginManifest`,
  `PluginContext`, `PluginFrontendModule`, `CoreHooks`).
- ✅ **`server`** — бекенд: auto-discovery плагінів, lifecycle
  `activate`/`deactivate`, HTTP-API, власний екземпляр `HookEngine`.
- ✅ **`web`** — фронтенд на Vite + React + Bootstrap + lucide-react:
  ChatGPT-style інтерфейс (згортаємий лівий сайдбар + основна область) з
  локальними сесіями чату, дашбордом, менеджером плагінів; каркас збирається
  через фільтри; динамічне завантаження фронт-плагінів; власний екземпляр
  `HookEngine`.
- ✅ **`plugins/example-plugin`** — демо-плагін, що доводить роботу системи
  на обох кінцях.

## Структура проекту

```
coudycode/
├── packages/
│   └── core/                # Ізоморфне ядро: HookEngine + типи
│       └── src/
│           ├── hooks.ts     # HookEngine (actions + filters, priority, async)
│           ├── types.ts     # PluginManifest, PluginContext, CoreHooks, …
│           └── index.ts     # Експорти
├── server/                  # Бекенд (workspace-пакет)
│   └── src/
│       ├── plugin-loader.ts # Auto-discover plugins/* + lifecycle
│       ├── server.ts        # Нативний HTTP-сервер + API
│       └── index.ts         # Точка входу
├── web/                     # Фронтенд (workspace-пакет)
│   └── src/
│       ├── hooks.ts         # Власний екземпляр HookEngine
│       ├── plugins.ts       # Завантаження + активація фронт-плагінів
│       ├── useCoudyUI.ts    # Динамічна хук-збірка UI в React
│       ├── App.tsx          # Корінь лейауту + роутинг за View
│       ├── Sidebar.tsx      # Згортаємий сайдбар (сесії + пункти плагінів + футер)
│       ├── Dashboard.tsx    # Дашборд (сітка віджетів)
│       ├── PluginManager.tsx # Менеджер плагінів (GET /api/plugins)
│       ├── ChatView.tsx     # Каркас чату активної сесії
│       ├── Settings.tsx     # Заглушка налаштувань
│       ├── sessions.ts      # Локальні сесії чату (state + localStorage)
│       └── types.ts         # SidebarItem, Route, DashboardWidget
├── plugins/
│   └── example-plugin/      # Демо-плагін
│       ├── plugin.json
│       ├── backend/index.js
│       └── frontend/index.js
└── package.json             # Workspace-корінь
```

## Запуск

Потрібен Node.js ≥ 20.

```bash
# 1. Встановити залежності (workspaces підхоплять core, server, web)
npm install

# 2а. Запустити все одразу (бекенд + фронт concurrently)
npm run dev

# 2б. Або окремо — у двох терміналах:
npm run dev:server   # бекенд на http://localhost:3001
npm run dev:web      # фронт на   http://localhost:5173
```

Відкрий **http://localhost:5173** — побачиш каркас застосунку, а демо-плагін
додасть пункт меню «Example Page», сторінку, кнопку тулбару та віджет.

### REST-API бекенду

| Метод | Шлях                  | Що повертає                                                |
|-------|-----------------------|------------------------------------------------------------|
| GET   | `/api/state`          | `{ status, startedAt, pluginsCount }`                      |
| GET   | `/api/plugins`        | `{ plugins: [{ name, title, version, description, frontendEntry, enabled }] }` |
| GET   | `/plugins/<name>/<file>` | Статичні файли плагіна (фронт робить `import(frontendEntry)`) |

У dev фронт проксує `/api` та `/plugins` на бекенд через Vite-proxy
(конфіг у `web/vite.config.ts`), тож CORS не потрібен.

## Як написати власний плагін

### 1. Структура папки

```
plugins/my-plugin/
├── plugin.json          # маніфест (обовʼязково)
├── backend/index.js     # backend entry (опціонально)
└── frontend/index.js    # frontend entry (опціонально)
```

### 2. Маніфест `plugin.json`

```json
{
  "name": "my-plugin",
  "version": "1.0.0",
  "title": "My Plugin",
  "description": "Що робить плагін",
  "enabled": true,
  "entry": {
    "backend": "./backend/index.js",
    "frontend": "./frontend/index.js"
  }
}
```

- `name` — унікальний id (kebab-case).
- `enabled: false` — плагін буде знайдено, але пропущено.
- `entry.backend` / `entry.frontend` — шляхи відносно `plugin.json`
  (будь-який можна опустити).

### 3. Backend entry — `PluginBackendModule`

Валідний ES-модуль, що експортує `activate(ctx)` та опціонально `deactivate(ctx)`.

```js
export function activate(ctx) {
  ctx.utils.log("стартую");

  // action — побічний ефект
  ctx.hooks.addAction("server:start", () => {
    ctx.utils.log("сервер стартував");
  });

  // filter — трансформація значення (повертай нове!)
  ctx.hooks.addFilter("prompt:system", (prompt) => `${prompt}\n[my-plugin]: …`);
}

export function deactivate(ctx) {
  ctx.utils.log("зупиняюсь");
}
```

`ctx` містить:
- `hooks` — `HookEngine` бекенду;
- `registry` — `PluginRegistry` (get/set/delete/clear/keys);
- `utils.log(msg, ...args)`, `utils.error(msg, ...args)`;
- `manifest` — обʼєкт маніфесту;
- `pluginPath` — абсолютний шлях до папки плагіна.

**Бекенд-хуки:**

| Хук                 | Тип     | Коли стріляє                              |
|---------------------|---------|-------------------------------------------|
| `server:start`      | action  | Після старту HTTP-сервера                 |
| `server:stop`       | action  | При зупинці сервера                       |
| `plugin:activate`   | action  | Після активації кожного плагіна (передається name) |
| `plugin:deactivate` | action  | Після деактивації плагіна                 |
| `prompt:system`     | filter  | (зарезервовано) системний промпт агента   |
| `tools:register`    | filter  | (зарезервовано) реєстр інструментів       |
| `providers:register`| filter  | (зарезервовано) реєстр провайдерів        |

### 4. Frontend entry — `PluginFrontendModule`

Валідний ES-модуль, що фронт динамічно імпортує через `import(frontendEntry)`.
Оскільки це окремий бандл, UI будуємо через `window.React.createElement`
(React експонується головним застосунком) — без JSX і без власної копії React.

```js
const R = window.React;

export function activate(ctx) {
  // Пункт сайдбару від плагіна (з'являється над системним футером)
  ctx.hooks.addFilter("ui:sidebar-items", (items) => [
    ...items,
    { id: "my", label: "My Plugin", icon: "LayoutGrid", routeId: "my" },
  ]);

  // Картка на дашборді
  ctx.hooks.addFilter("ui:dashboard-widgets", (widgets) => [
    ...widgets,
    { id: "my-widget", title: "My Widget", render: () => R.createElement("p", null, "…") },
  ]);

  // Сторінка плагіна (повна сторінка)
  ctx.hooks.addFilter("ui:routes", (routes) => [
    ...routes,
    { id: "my", label: "My Plugin", render: () => R.createElement("h1", null, "Привіт!") },
  ]);
}
```

`ctx` на фронті = `{ hooks, registry, utils: {log, error}, manifest }`.

**Фронтенд-фільтри** (callback отримує поточний масив, повертає розширений —
**не мутуй**, повертай новий `[...items, newItem]`):

| Фільтр                | Що додає                          | Тип елемента                         |
|-----------------------|-----------------------------------|--------------------------------------|
| `ui:sidebar-items`     | Пункт сайдбару (над футером)      | `{ id, label, icon?, routeId? }`     |
| `ui:dashboard-widgets` | Картку на дашборді                | `{ id, title, render: () => ReactNode }` |
| `ui:routes`            | Сторінку/роут                     | `{ id, label, render: () => ReactNode }` |

`icon` — назва іконки Lucide. `routeId` пункта сайдбару має збігатися з
`id` роуту — тоді клік відкриває відповідну сторінку.

## Як це працює

1. **Бекенд** при старті сканує `plugins/*/`, читає `plugin.json`, dynamic
   `import()` backend-entry і викликає `activate(ctx)`. Плагіни реєструють
   хуки на бекендовому `HookEngine`.
2. **Фронт** при завантаженні фетчить `/api/plugins`, для увімкнених з
   `frontendEntry` робить `import(frontendEntry)` і викликає `activate(ctx)`.
   Плагіни реєструють фільтри `ui:*` на браузерному `HookEngine`.
3. Після активації всіх плагінів фронт викликає `applyFilters("ui:sidebar-items", …)`,
   `"ui:dashboard-widgets"`, `"ui:routes"` і кладе результат у React-стан →
   UI рендериться з розширеними елементами.
