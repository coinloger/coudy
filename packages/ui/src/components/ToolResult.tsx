import { Diff } from "./Diff.tsx";
import type { ImageContent, TextContent } from "@coudycode/ai";

export interface ToolResultDiff {
	oldContent: string;
	newContent: string;
}

export interface ToolResultProps {
	/** Ім'я інструменту (для спец-обробки edit/write). */
	toolName: string;
	/** Content результату (текст + зображення). */
	content: (TextContent | ImageContent)[];
	/** Чи помилка. */
	isError?: boolean;
	/** Структуровані details (напр. edit → { diff, patch }). */
	details?: unknown;
	/** Опційний structured-diff для компонента Diff (мок/юзер надає old+new). */
	diff?: ToolResultDiff;
}

/**
 * Результат інструменту: текстовий вивід; для edit/write — диф.
 * Вміє рендерити як готовий unified-diff (з details.diff рядком), так і
 * structured-diff (з prop diff → Diff компонент).
 */
export function ToolResult({ toolName, content, isError, details, diff }: ToolResultProps): React.ReactNode {
	const textContent = content
		.filter((c): c is TextContent => c.type === "text")
		.map((c) => c.text)
		.join("\n");
	const images = content.filter((c): c is ImageContent => c.type === "image");

	// Structured diff (мок/юзер) — найчистіша візуалізація.
	if (diff) {
		return (
			<div>
				<Diff oldContent={diff.oldContent} newContent={diff.newContent} />
				{textContent && <pre style={{ marginTop: "0.5rem" }}>{textContent}</pre>}
			</div>
		);
	}

	// edit/write: details.diff — це unified-diff рядок (з реального інструменту).
	const detailsDiff = extractDiff(details);
	if ((toolName === "edit" || toolName === "write") && detailsDiff) {
		return <pre>{detailsDiff}</pre>;
	}

	return (
		<div>
			{isError && <div style={{ color: "#dc3545", fontWeight: 600 }}>⚠ Помилка</div>}
			{textContent && <pre>{textContent}</pre>}
			{images.length > 0 && (
				<div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", marginTop: "0.5rem" }}>
					{images.map((img, idx) => (
						<img
							key={idx}
							src={`data:${img.mimeType};base64,${img.data}`}
							alt="tool output"
							style={{ maxWidth: "12rem", borderRadius: "0.4rem" }}
						/>
					))}
				</div>
			)}
		</div>
	);
}

function extractDiff(details: unknown): string | undefined {
	if (details && typeof details === "object" && "diff" in details) {
		const v = (details as { diff: unknown }).diff;
		if (typeof v === "string") return v;
	}
	return undefined;
}
