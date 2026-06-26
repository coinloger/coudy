import { useState } from "react";
import type { ThinkingContent } from "@coudycode/ai";

export interface ThinkingBlockProps {
	content: ThinkingContent;
	/** Чи триває стрімінг thinking (показуємо курсор). */
	streaming?: boolean;
}

/** Згорнутий блок thinking моделі — клік розгортає. */
export function ThinkingBlock({ content, streaming }: ThinkingBlockProps): React.ReactNode {
	const [open, setOpen] = useState(false);
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
				<span>{open ? "▼" : "▶"}</span>
				<span>{content.redacted ? "Thinking (redacted)" : "Thinking"}</span>
				{streaming && <span className="cc-ui-streaming-cursor" />}
			</div>
			{open && !content.redacted && (
				<div className="cc-ui-thinking-body">{content.thinking}</div>
			)}
		</div>
	);
}
