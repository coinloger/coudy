import { useState } from "react";
import type { ToolCall as ToolCallContent } from "@coudycode/ai";
import { ChevronDown, ChevronRight, Wrench } from "lucide-react";
import { describeToolCall } from "./tool-summary.ts";
import { ToolGroup, type ToolGroupEntry } from "./ToolGroup.tsx";
import { ToolCall, type ToolCallStatus } from "./ToolCall.tsx";

export interface ToolActivityEntry {
	call: ToolCallContent;
	status?: ToolCallStatus;
	/** Результат інструменту (рендериться при розкритті). */
	result?: React.ReactNode;
}

export interface ToolActivityProps {
	/** Усі tool-виклики, згруповані за хід (між user-повідомленням і фінальною відповіддю). */
	entries: ToolActivityEntry[];
}

/**
 * Згорнутий tool-блок ходу: ОДИН мінімальний subdued рядок («Агент попрацював: N дій»),
 * клік → повний список з деталями (через ToolGroup — згортає послідовні однотипні тулзи).
 *
 * Призначення: діалог читається як Q&A (user-питання → assistant-текст), тулзи —
 * внутрішня механіка, не домінують. Процес роботи показує WorkIndicator; тут лише
 * доступ до деталей по явному розкриттю.
 */
export function ToolActivity({ entries }: ToolActivityProps): React.ReactNode {
	const [open, setOpen] = useState(false);
	if (entries.length === 0) return null;

	const calls = entries.map((e) => e.call);
	const running = entries.some((e) => e.status === "running");
	const errored = entries.some((e) => e.status === "error");

	// Згорнутий summary: одиночний → опис дії; група → дієслова + count по категоріях
	// («Прочитав 23 файли · Виконав 5 команд»), не голий лічильник.
	const label = calls.length === 1 ? describeToolCall(calls[0]!) : summarizeActivities(calls);
	const labelFull = calls.length > 1 ? fullSummary(calls) : undefined;

	const groupEntries: ToolGroupEntry[] = entries.map((e) => ({
		call: e.call,
		status: e.status,
		result: e.result,
	}));

	return (
		<div className="cc-ui-activity">
			<div
				className="cc-ui-activity-head"
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
				<span className="cc-ui-activity-chevron">
					{open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
				</span>
				<span className="cc-ui-activity-icon">
					<Wrench size={12} />
				</span>
				<span className="cc-ui-activity-label" title={labelFull}>
					{label}
				</span>
				{running && <span className="cc-ui-activity-running">…</span>}
				{errored && !running && <span className="cc-ui-activity-error-mark">!</span>}
			</div>
			{open && (
				<div className="cc-ui-activity-body">
					{entries.length === 1 ? (
						<ToolCall call={entries[0]!.call} status={entries[0]!.status}>
							{entries[0]!.result}
						</ToolCall>
					) : (
						<ToolGroup entries={groupEntries} />
					)}
				</div>
			)}
		</div>
	);
}

/** Опис категорії тулзів: дієслово (минулий час) + іменник у 3 формах (1 / 2-4 / 5+). */
interface Category {
	verb: string;
	/** [однина, 2-4, 5+] — українське відмінковування. */
	noun: [string, string, string];
}

const CATEGORIES: Record<string, Category> = {
	read: { verb: "Прочитав", noun: ["файл", "файли", "файлів"] },
	edit: { verb: "Змінив", noun: ["файл", "файли", "файлів"] },
	write: { verb: "Створив", noun: ["файл", "файли", "файлів"] },
	bash: { verb: "Виконав", noun: ["команду", "команди", "команд"] },
	grep: { verb: "Знайшов", noun: ["збіг", "збіги", "збігів"] },
	find: { verb: "Знайшов", noun: ["файл", "файли", "файлів"] },
	ls: { verb: "Переглянув", noun: ["директорію", "директорії", "директорій"] },
	fetch: { verb: "Завантажив", noun: ["сторінку", "сторінки", "сторінок"] },
	browse: { verb: "Відкрив", noun: ["сторінку", "сторінки", "сторінок"] },
	web_search: { verb: "Шукав", noun: ["запит", "запити", "запитів"] },
	analyze: { verb: "Проаналізував", noun: ["контекст", "контексти", "контекстів"] },
	compact: { verb: "Стиснув", noun: ["контекст", "контексти", "контекстів"] },
};

/** Відмінковування іменника за числом (1 / 2-4 / 5+). */
function decline(n: number, forms: [string, string, string]): string {
	const mod10 = n % 10;
	const mod100 = n % 100;
	if (mod10 === 1 && mod100 !== 11) return forms[0];
	if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return forms[1];
	return forms[2];
}

/** Опис однієї категорії: «Прочитав 23 файли». */
function describeCategory(name: string, count: number): string {
	const cat = CATEGORIES[name];
	if (!cat) return `${count}× ${name}`;
	return `${cat.verb} ${count} ${decline(count, cat.noun)}`;
}

/** Згорнутий summary: домінантні 2-3 категорії + «+N», не голий лічильник. */
function summarizeActivities(calls: ToolCallContent[]): string {
	const counts = new Map<string, number>();
	for (const c of calls) counts.set(c.name, (counts.get(c.name) ?? 0) + 1);
	// Сортувати за спаданням к-сті (домінантні спереду).
	const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
	const top = sorted.slice(0, 3).map(([name, count]) => describeCategory(name, count));
	const rest = sorted.slice(3).reduce((sum, [, c]) => sum + c, 0);
	return rest > 0 ? `${top.join(" · ")} · +${rest}` : top.join(" · ");
}

/** Повний summary (для title/tooltip): усі категорії. */
function fullSummary(calls: ToolCallContent[]): string {
	const counts = new Map<string, number>();
	for (const c of calls) counts.set(c.name, (counts.get(c.name) ?? 0) + 1);
	return [...counts.entries()]
		.sort((a, b) => b[1] - a[1])
		.map(([name, count]) => describeCategory(name, count))
		.join(" · ");
}
