import { useState } from "react";
import type { ToolCall as ToolCallContent } from "@coudycode/ai";
import { ChevronDown, ChevronRight, Wrench } from "lucide-react";
import { describeToolGroup, describeToolCall } from "./tool-summary.ts";
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

	// Згорнутий summary: одиночний → опис дії; група → «Агент попрацював: N дій».
	const label =
		calls.length === 1
			? describeToolCall(calls[0]!)
			: `Агент попрацював: ${calls.length} ${plural(calls.length)}`;

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
				<span className="cc-ui-activity-label" title={calls.length > 1 ? describeToolGroup(calls) : undefined}>
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

function plural(n: number): string {
	const mod10 = n % 10;
	const mod100 = n % 100;
	if (mod10 === 1 && mod100 !== 11) return "дія";
	if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return "дії";
	return "дій";
}
