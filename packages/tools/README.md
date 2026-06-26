# @coudycode/tools

Headless-інструменти агента для coudycode: `read`, `edit`, `write`, `bash`, `grep`, `find`, `ls`, `fetch`.

Винесено з pi-донора як **рефакторинг (не копія 1:1)**: прибрано всю TUI-обв'язку (`@earendil-works/pi-tui`, `renderCall`/`renderResult`, `Theme`, інтерактивні рендер-компоненти), залишено чисту логіку `execute`. Замість важкого `ExtensionContext` використовується мінімальний `ToolContext` (`model?`, `getStreamFn?`) — лише `read` читає `ctx.model` (для vision-підтримки).

## Залежності
- `@coudycode/ai`, `@coudycode/agent-core` (workspace)
- `typebox`, `cross-spawn`, `diff`, `jq-wasm` (fetch — jq-фільтрація JSON), `@silvia-odwyer/photon-node` (зміна розміру зображень у `read`, lazy, вимкнено за замовчуванням)

## Зовнішні інструменти
`grep`/`find` очікують `ripgrep` (rg) та `fd` у системному PATH. Якщо їх немає — `ensureTool` кидає зрозумілу помилку з підказкою встановлення (`brew install ripgrep fd` тощо). На відміну від донора, автоматичне завантаження з GitHub-релізів прибрано.

## Використання

```ts
import { createAllTools } from "@coudycode/tools";

// Усі 8 інструментів → AgentTool[] для runAgentLoop (@coudycode/agent-core)
const tools = createAllTools(process.cwd(), {
  bash: { commandPrefix: "sudo", maxTimeoutSec: 300 },
  read: { autoResizeImages: false }, // за замовч. false (lazy WASM)
});

// Або підмножини:
createCodingTools(cwd);    // read, bash, edit, write
createReadOnlyTools(cwd);  // read, grep, find, ls
createTool("read", cwd, options); // окремий інструмент
```

## Експорти
- `createAllTools(cwd, options?)` → `AgentTool[]`
- `createCodingTools`, `createReadOnlyTools`, `createTool`
- Окремі `create{Read,Bash,Edit,Write,Grep,Find,Ls,Fetch}Tool(cwd, options?)`
- `wrapToolDefinition`/`wrapToolDefinitions` — міст `ToolDefinition → AgentTool`
- Типи: `ToolContext`, `ToolDefinition`, `ToolsOptions`, `*ToolOptions`, `*ToolDetails`, `*ToolInput`

## Білд
```bash
npm run build --workspace=packages/tools   # tsgo -p tsconfig.build.json
```
ESM / Node16, як у донорі. `@earendil-works`/`pi-tui` — 0 посилань.
