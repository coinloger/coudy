export interface DiffProps {
	/** Старий вміст файлу. */
	oldContent: string;
	/** Новий вміст файлу. */
	newContent: string;
}

interface DiffLine {
	type: "add" | "del" | "context";
	text: string;
}

/** Обчислити простий line-diff між old/new (LCS за рядками). */
function computeLineDiff(oldText: string, newText: string): DiffLine[] {
	const oldLines = oldText.split("\n");
	const newLines = newText.split("\n");
	const m = oldLines.length;
	const n = newLines.length;

	// LCS-таблиця
	const dp: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
	for (let i = m - 1; i >= 0; i--) {
		for (let j = n - 1; j >= 0; j--) {
			dp[i][j] = oldLines[i] === newLines[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
		}
	}

	const result: DiffLine[] = [];
	let i = 0;
	let j = 0;
	while (i < m && j < n) {
		if (oldLines[i] === newLines[j]) {
			result.push({ type: "context", text: oldLines[i] });
			i++;
			j++;
		} else if (dp[i + 1][j] >= dp[i][j + 1]) {
			result.push({ type: "del", text: oldLines[i] });
			i++;
		} else {
			result.push({ type: "add", text: newLines[j] });
			j++;
		}
	}
	while (i < m) {
		result.push({ type: "del", text: oldLines[i++] });
	}
	while (j < n) {
		result.push({ type: "add", text: newLines[j++] });
	}
	return result;
}

/** Візуалізація змін файлу: додані рядки зеленим, видалені — червоним. */
export function Diff({ oldContent, newContent }: DiffProps): React.ReactNode {
	const lines = computeLineDiff(oldContent, newContent);
	return (
		<div className="cc-ui-diff">
			{lines.map((line, idx) => (
				<div
					key={idx}
					className={`cc-ui-diff-line ${
						line.type === "add" ? "cc-ui-diff-add" : line.type === "del" ? "cc-ui-diff-del" : ""
					}`}
				>
					<span className="cc-ui-diff-gutter">
						{line.type === "add" ? "+" : line.type === "del" ? "-" : " "}
					</span>
					<span className="cc-ui-diff-content">{line.text || " "}</span>
				</div>
			))}
		</div>
	);
}
