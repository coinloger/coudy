# @coudycode/ui

React UI-двигун для рендерингу агентних взаємодій у coudycode. Споживає **реальні типи** з `@coudycode/agent-core` (`AgentMessage`, `AgentEvent`) та `@coudycode/ai` (content-блоки: `text` / `thinking` / `toolCall` / `image`) — моделюється навколо них, щоб згодом без швів підключити движок агента.

## Компоненти

- **`ConversationView`** — рендерить `AgentMessage[]` (user/assistant/toolResult + кастомні ролі). Приєднує tool-result'и до tool-call'ів за `toolCallId`.
- **`UserMessage` / `AssistantMessage` / `SystemMessage`** — повідомлення за роллю.
- **`MarkdownRenderer`** — markdown через `react-markdown`, з курсором стрімінгу в кінці.
- **`CodeBlock`** — код з підсвіткою синтаксису (мова з ```fence).
- **`ToolCall`** — виклик інструменту (ім'я, JSON-аргументи, статус running/done/error), розгортається.
- **`ToolResult`** — результат: текст/код/зображення; для edit/write — диф.
- **`Diff`** — візуалізація змін файлу (added зеленим / removed червоним, LCS за рядками).
- **`ThinkingBlock`** — згорнутий thinking моделі (клік → розгорнути).
- **`WorkingIndicator`** — індикатор що агент працює (спінер).

## Стрім-акумулятор
`applyEvent(state, event)` + `initialConversationState` — чиста функція, що з потоку `AgentEvent` (`agent_start/end`, `message_start/update/end`, `tool_execution_*`) будує `ConversationState` (`messages`, `streamingMessage`, `toolStatus`, `working`) для `ConversationView`. Це міст при підключенні `runAgentLoop`.

## Підсвітка коду
Обрано **`react-syntax-highlighter`** (Prism) — React-native, синхронний (рендерить одразу під час стрімінгу, без async WASM як у shiki), багато мов з коробки.

## Використання
```tsx
import { ConversationView, applyEvent, initialConversationState } from "@coudycode/ui";
import "@coudycode/ui/styles.css";

// state накопичується з AgentEvent потоку:
const state = events.reduce(applyEvent, initialConversationState);

<ConversationView
  messages={state.messages}
  toolStatus={state.toolStatus}
  streamingMessage={state.streamingMessage}
  streamingTextIndex={state.streamingTextIndex}
/>
```

## Білд
```bash
npm run build --workspace=packages/ui   # tsgo -p tsconfig.build.json
```
ESM / Node16 / jsx react-jsx. peerDeps: react, react-dom. Деплоїться як `import` → `src/index.tsx` (для Vite/tsx), production → `dist/index.js`.
