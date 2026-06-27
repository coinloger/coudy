import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneLight } from "react-syntax-highlighter/dist/esm/styles/prism";

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
			style={oneLight}
			// Світла тема код-блоку (узгоджена зі світлою сторінкою pi).
			customStyle={{
				background: "#f1f3f5",
				border: "1px solid var(--pi-border-muted)",
				borderRadius: "0.4rem",
				fontSize: "0.82rem",
				margin: 0,
				color: "#1f2328",
				textShadow: "none",
			}}
			codeTagProps={{
				style: { fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace', color: "#1f2328", textShadow: "none" },
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
