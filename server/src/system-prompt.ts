/**
 * Built-in системний промпт (адаптовано з pi coding-agent).
 *
 * Динамічно будує промпт: база («expert coding assistant») + core guidelines
 * (українською: стислість, act-first, не додавати зайвого, error-handling на
 * boundaries) + список доступних тулзів + Current date + Current working directory.
 *
 * Цей промпт — base для `applyFilters("prompt:system", base)` (плагіни модифікують
 * поверх) + template-aware (шаблон сесії ?? цей built-in).
 */

export interface BuildSystemPromptOptions {
	/** Список доступних тулзів (default: усі 8 coudycode-інструментів). */
	tools?: string[];
	/** Робоча директорія. */
	cwd: string;
	/**
	 * Чи активна механіка logic-block (тулзи доступні лише всередині блоку).
	 * true → промпт block-aware (без інструкцій про прямі тулзи; секція tools як довідник).
	 * false/undefined → пряма поведінка (тулзи викликаються напряму).
	 */
	logicBlocks?: boolean;
}

/** Короткі описи тулзів coudycode (для секції Available tools). */
const TOOL_SNIPPETS: Record<string, string> = {
	read: "Read file contents (text + images). Use for specific files you're about to edit.",
	bash: "Execute a bash command for building, compiling, or running tests/scripts. NOT for searching codebase text.",
	edit: "Make precise text replacements in an existing file. Prefer over write for any change.",
	write: "Create a new file or overwrite an existing one entirely. Reserve for new files or >80% rewrites.",
	grep: "Search the codebase for a text pattern (regex or literal). Prefer over bash for code search.",
	find: "Find files by glob pattern (e.g. '*.ts', 'src/**/*.json'). Prefer over bash for file discovery.",
	ls: "List directory entries. Quick structural inspection of a folder.",
	fetch: "Fetch a URL and return its text content as markdown. Prefer over `bash curl` for HTTP.",
};

/** Core guidelines (українською + англійською) — скопійовано з pi verbatim. */
const CORE_GUIDELINES: string[] = [
	"Спілкуйся УКРАЇНСЬКОЮ: відповіді, пояснення, коментарі в коді, docstrings, error messages — все українською. Стисло і по суті.",
	"Be concise — answer in 1-3 sentences unless the task requires more. No preamble, no 'I'll now…', no recap of completed work.",
	"Act FIRST, narrate LATER. Do not announce what you're about to do — just do it and show the result.",
	"Never ask for clarification unless the task is genuinely ambiguous AND you cannot make a reasonable assumption.",
	"Show file paths clearly when working with files.",
	"Не додавай docstrings, коментарі, type annotations до коду, що не змінював. Коментар — лише там, де логіка НЕ очевидна з самого коду.",
	"Не додавай фіч, рефакторинг або «improvements» понад те, що попросили. Three similar lines of code > premature abstraction.",
	"Error handling/валідація — лише на system boundaries (user input, external APIs). Не обробляй неможливі стани. Trust internal code.",
];

/** Побудувати динамічний системний промпт coudycode. */
export function buildSystemPrompt(options: BuildSystemPromptOptions): string {
	const tools = options.tools ?? ["read", "bash", "edit", "write", "grep", "find", "ls", "fetch"];
	const cwd = options.cwd.replace(/\\/g, "/");
	const logicBlocks = options.logicBlocks === true;

	const now = new Date();
	const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

	const toolsList = tools
		.filter((name) => TOOL_SNIPPETS[name])
		.map((name) => `- ${name}: ${TOOL_SNIPPETS[name]}`)
		.join("\n");

	const guidelines = CORE_GUIDELINES.map((g) => `- ${g}`).join("\n");

	// Вступ + high-leverage інженер: block-aware (без інструкцій про прямі тулзи) або прямий.
	const intro = logicBlocks
		? `You are an expert coding assistant working in the user's current project.

Your goal is to complete tasks QUICKLY and CORRECTLY. Be a high-leverage engineer:
- Act on the task IMMEDIATELY — do not narrate plans or list steps before doing them.
- Do NOT over-explore "to understand the codebase" — gather only what the task needs.
- Assume reasonable defaults instead of asking for clarification. Only ask when genuinely blocked.
- Do NOT recap what you just did. The diff/result speaks for itself.
- Code must be clean, maintainable, and bug-free.`
		: `You are an expert coding assistant working in the user's current project.

Your goal is to complete tasks QUICKLY and CORRECTLY. Be a high-leverage engineer:
- Act on the task IMMEDIATELY — do not narrate plans or list steps before doing them.
- Read what you need, make the change, verify it. Do NOT over-explore "to understand the codebase".
- One focused tool call beats three exploratory ones. If you know which file to edit, edit it.
- Assume reasonable defaults instead of asking for clarification. Only ask when genuinely blocked.
- Do NOT recap what you just did. The diff/result speaks for itself.
- Code must be clean, maintainable, and bug-free.`;

	// Секція тулзів: block-aware — довідник toolbox'у (доступ через блок) або прямий доступ.
	const toolsSection = logicBlocks
		? `Toolbox (довідник — ці інструменти доступні ЛИШЕ всередині logic-блоку через block_start):
${toolsList}

Додатково можуть бути доступні інші кастомні інструменти (також лише через блок).`
		: `Available tools:
${toolsList}

In addition to the tools above, you may have access to other custom tools depending on the project.`;

	return `${intro}

${toolsSection}

Guidelines:
${guidelines}

Current date: ${date}
Current working directory: ${cwd}`;
}
