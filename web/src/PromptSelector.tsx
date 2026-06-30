import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, ScrollText } from "lucide-react";

/** Шаблон системного промпту (з GET /api/prompts). */
export interface PromptTemplateEntry {
	id: string;
	name: string;
	content: string;
	createdAt: string;
	/** null = усі тулзи; [] = без; [...] = лише ці. */
	tools?: string[] | null;
	/** true = захищений (не видаляється). */
	protected?: boolean;
	/** Група: "standard" (дефолт) | "<pluginName>". */
	group?: string;
}

export interface PromptSelectorProps {
	/** Обраний шаблон сесії (null = built-in SYSTEM_PROMPT). */
	current: { id: string; name: string } | null;
	templates: PromptTemplateEntry[];
	/** Зберегти привʼязку → POST /api/sessions/:id/prompt-template. */
	onSelect: (templateId: string | null) => void;
}

/**
 * Селектор шаблону системного промпту (per-session): компактний дропдаун з іконкою.
 * Опція «За замовчуванням» (null = built-in SYSTEM_PROMPT).
 */
export function PromptSelector({ current, templates, onSelect }: PromptSelectorProps): React.ReactNode {
	const [open, setOpen] = useState(false);
	const boxRef = useRef<HTMLDivElement>(null);

	// Закриття по кліку-зовні та Escape.
	useEffect(() => {
		if (!open) return;
		const onClick = (e: MouseEvent): void => {
			if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
		};
		const onKey = (e: KeyboardEvent): void => {
			if (e.key === "Escape") setOpen(false);
		};
		document.addEventListener("mousedown", onClick);
		document.addEventListener("keydown", onKey);
		return () => {
			document.removeEventListener("mousedown", onClick);
			document.removeEventListener("keydown", onKey);
		};
	}, [open]);

	// Згрупувати шаблони за group (default "standard"), зберігаючи порядок появи.
	const groups = useMemo<Array<[string, PromptTemplateEntry[]]>>(() => {
		const map = new Map<string, PromptTemplateEntry[]>();
		for (const t of templates) {
			const g = t.group ?? "standard";
			const arr = map.get(g);
			if (arr) arr.push(t); else map.set(g, [t]);
		}
		return Array.from(map.entries());
	}, [templates]);

	// Якщо немає жодного шаблону — селектор ховається (нема з чого вибирати).
	if (templates.length === 0) return null;

	const handlePick = (templateId: string | null): void => {
		onSelect(templateId);
		setOpen(false);
	};

	const groupLabel = (g: string): string => (g === "standard" ? "Стандартні" : g);

	return (
		<div className="cc-ui-model-selector" ref={boxRef}>
			<button
				type="button"
				className="cc-ui-model-trigger"
				onClick={() => setOpen((v) => !v)}
				title="Шаблон системного промпту"
			>
				<ScrollText size={13} className="me-1" />
				<span className="cc-ui-model-label">{current ? current.name : "Промпт за замовч."}</span>
				<ChevronDown size={14} className={open ? "cc-ui-model-chevron-open" : ""} />
			</button>

			{open && (
				<div className="cc-ui-model-dropdown" role="listbox">
					<div className="cc-ui-model-list">
						<button
							type="button"
							className={`cc-ui-model-option${current === null ? " cc-ui-model-option-active" : ""}`}
							onClick={() => handlePick(null)}
							title="Вбудований системний промпт"
						>
							<span className="cc-ui-model-option-label">За замовчуванням</span>
							{current === null && <Check size={13} className="cc-ui-model-check" />}
						</button>
						{groups.map(([g, items]) => (
							<div key={g} className="cc-ui-model-group">
								<div className="cc-ui-model-group-label">{groupLabel(g)}</div>
								{items.map((t) => {
									const active = current?.id === t.id;
									return (
										<button
											key={t.id}
											type="button"
											className={`cc-ui-model-option${active ? " cc-ui-model-option-active" : ""}`}
											onClick={() => handlePick(t.id)}
											title={t.content}
										>
											<span className="cc-ui-model-option-label">{t.name}</span>
											{active && <Check size={13} className="cc-ui-model-check" />}
										</button>
									);
								})}
							</div>
						))}
					</div>
				</div>
			)}
		</div>
	);
}
