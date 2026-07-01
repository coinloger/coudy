import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { CodeBlock } from "./CodeBlock.tsx";

export interface MarkdownRendererProps {
	/** Markdown-текст (частковий під час стрімінгу). */
	content: string;
	/** Чи триває стрімінг → показуємо пульсуючий курсор у кінці. */
	streaming?: boolean;
}

/** Рендерить markdown-контент з підсвіткою коду у fences. */
export function MarkdownRenderer({ content }: MarkdownRendererProps): React.ReactNode {
	return (
		<div className="cc-ui-msg-body">
			<ReactMarkdown
				remarkPlugins={[remarkGfm]}
				components={{
					// react-markdown v9 обгортає block-code у <pre>, а CodeBlock рендерить
					// власний <pre> (SyntaxHighlighter) → pass-through щоб уникнути подвійного <pre>/фону.
					pre({ children }): React.ReactNode {
						return <>{children}</>;
					},
					code(props): React.ReactNode {
						const { className, children } = props;
						const text = String(children ?? "");
						// Блок коду у fence (react-markdown v9 передає class "language-xxx" лише для блоків).
						const match = /language-(\w+)/.exec(className ?? "");
						if (match) {
							return <CodeBlock code={text.replace(/\n$/, "")} language={match[1]} />;
						}
						// Багаторядковий код без мови → plain-блок (підсвітка text).
						if (text.includes("\n")) {
							return <CodeBlock code={text.replace(/\n$/, "")} language="text" />;
						}
						// Інлайн-код лишаємо як <code> (стилізує CSS).
						return <code className={className}>{children}</code>;
					},
				}}
			>
				{content}
			</ReactMarkdown>
		</div>
	);
}
