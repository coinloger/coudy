# @coudycode/library

Self-growing глобальна бібліотека функцій (skill library): LLM сама будує,
шукає, викликає параметрами та покращує перевикористовувані функції.

## Концепція

Замість одноразового bash/python агент будує **глобальну бібліотеку**:
задача → **обовʼязковий пошук** → знайдено? `call` → ні? `create` нову → reuse наступного разу.
Методи компонуються (`ctx.call` викликає інші).

## Сховище

`~/.coudycode/library/`
- `index.json` — маніфест (entries + embeddings, 0o600)
- `<category>/<name>.ts` — ESM-модулі функцій (0o600)

Формат модуля:
```ts
export const meta = { name: "delete_contract", category: "markets", description: "...", params: {...}, tags: [...] };
export async function run(params, ctx): Promise<unknown> { /* тіло */ }
```

## LibraryCtx

- `ctx.fs` — read/write/readJson/writeJson/exists
- `ctx.sh(command)` — shell-out (python/go/sqlite3)
- `ctx.proc` — керування процесами (ProcessRegistry)
- `ctx.db` — шлях до sqlite db
- `ctx.path` — join/resolve
- `ctx.call(name, params)` — **композиція** (виклик інших методів)

## Пошук

- **Семантичний**: embeddings описів (`@xenova/transformers`, all-MiniLM-L6-v2, 384-dim), cosine similarity top-K
- **Keyword fallback**: substring по name/tags/description
