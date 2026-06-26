import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";

export interface CodeBlockProps {
	code: string;
	/** Мова (з ```fence). Невідома/null → plain text. */
	language?: string | null;
}

/** Блок коду з підсвіткою синтаксису (react-syntax-highlighter / Prism). */
export function CodeBlock({ code, language }: CodeBlockProps): React.ReactNode {
	const lang = normalizeLanguage(language);
	return (
		<SyntaxHighlighter
			language={lang}
			// Мінімальний інлайн-стиль, щоб не тягнути готову тему окремим імпортом.
			customStyle={{
				background: "#1e1e2e",
				borderRadius: "0.4rem",
				fontSize: "0.82rem",
				margin: 0,
			}}
			codeTagProps={{
				style: { fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace' },
			}}
		>
			{code}
		</SyntaxHighlighter>
	);
}

function normalizeLanguage(lang?: string | null): string {
	if (!lang) return "text";
	const lower = lang.toLowerCase();
	// Поширені аліаси
	const aliases: Record<string, string> = {
		ts: "typescript",
		tsx: "tsx",
		js: "javascript",
		jsx: "jsx",
		py: "python",
		rb: "ruby",
		sh: "bash",
		shell: "bash",
		yml: "yaml",
		md: "markdown",
	};
	return aliases[lower] ?? lower;
}
