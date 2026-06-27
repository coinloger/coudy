import { useEffect, useState } from "react";
import type { ThinkingContent } from "@coudycode/ai";
import { ChevronDown, ChevronRight } from "lucide-react";

export interface ThinkingBlockProps {
	content: ThinkingContent;
	/** Чи триває стрімінг thinking (показуємо 3 крапки). */
	streaming?: boolean;
}

/**
 * Компактний рядок thinking моделі: лейбл + анімовані 3 крапки під час стріму.
 * Текст НЕ показується інлайн. Клік → overlay (absolute, z-index) з повним текстом
 * поверх контенту, не зсуваючи layout. Закриття: клік-зовні / кнопка / Escape.
 */
export function ThinkingBlock({ content, streaming }: ThinkingBlockProps): React.ReactNode {
	const [open, setOpen] = useState(false);

	useEffect(() => {
		if (!open) return;
		const onKey = (e: KeyboardEvent): void => {
			if (e.key === "Escape") setOpen(false);
		};
		document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
	}, [open]);

	return (
		<div className="cc-ui-thinking">
			<div
				className="cc-ui-thinking-head"
				onClick={() => setOpen((v) => !v)}
				role="button"
				tabIndex={0}
				onKeyDown={(e) => {
					if (e.key === "Enter" || e.key === " ") {
						e.preventDefault();
						setOpen((v) => !v);
					}
				}}
			>
				<span className="cc-ui-thinking-chevron">
					{open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
				</span>
				<span className="cc-ui-thinking-label">
					{streaming ? "Thinking" : content.redacted ? "Thinking (redacted)" : "Thoughts"}
				</span>
				{streaming && (
					<span className="cc-ui-thinking-dots" aria-hidden="true">
						<span />
						<span />
						<span />
					</span>
				)}
			</div>
			{open && !content.redacted && (
				<>
					<div className="cc-ui-thinking-backdrop" onClick={() => setOpen(false)} />
					<div className="cc-ui-thinking-overlay" role="dialog" aria-label="Thinking">
						<div className="cc-ui-thinking-overlay-bar">
							<span>Thinking</span>
							<button
								type="button"
								className="cc-ui-thinking-close"
								onClick={() => setOpen(false)}
								aria-label="Закрити"
							>
								×
							</button>
						</div>
						<div className="cc-ui-thinking-body">{content.thinking}</div>
					</div>
				</>
			)}
		</div>
	);
}
