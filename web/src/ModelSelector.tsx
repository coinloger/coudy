import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Check, ChevronDown, Plus, Search } from "lucide-react";

/** Публічне представлення моделі (з GET /api/models). */
export interface ModelEntry {
	id: string;
	label: string;
	provider: string;
	api: string;
	contextWindow: number;
	maxTokens: number;
	reasoning: boolean;
	input: string[];
}

/** Група моделей одного провайдера. */
export interface ProviderGroup {
	provider: string;
	models: ModelEntry[];
}

/** Поточна обрана модель (з GET /api/model). */
export interface CurrentModel {
	provider: string;
	modelId: string;
	label: string;
}

export interface ModelSelectorProps {
	current: CurrentModel;
	catalog: ProviderGroup[];
	/** Обрати модель → POST /api/model. */
	onSelect: (provider: string, modelId: string) => void;
}

/** Селектор моделі: клікабельний дропдаун ▾ {model} з пошуком + групами за провайдером. */
export function ModelSelector({ current, catalog, onSelect }: ModelSelectorProps): React.ReactNode {
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState("");
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

	// Фільтрація каталогу за пошуковим запитом (по назві або id).
	const filtered = useMemo<ProviderGroup[]>(() => {
		const q = query.trim().toLowerCase();
		if (!q) return catalog;
		return catalog
			.map((g) => ({
				provider: g.provider,
				models: g.models.filter(
					(m) => m.label.toLowerCase().includes(q) || m.id.toLowerCase().includes(q),
				),
			}))
			.filter((g) => g.models.length > 0);
	}, [catalog, query]);

	const handlePick = (provider: string, modelId: string): void => {
		onSelect(provider, modelId);
		setOpen(false);
		setQuery("");
	};

	// Порожньо — жодного провайдера не підключено → заклик у налаштування.
	if (catalog.length === 0) {
		return (
			<Link
				to="/settings"
				className="cc-ui-model-trigger cc-ui-model-empty-trigger"
				title="Підключіть провайдера в налаштуваннях"
			>
				<Plus size={14} />
				<span className="cc-ui-model-label">Підключіть провайдера</span>
			</Link>
		);
	}

	return (
		<div className="cc-ui-model-selector" ref={boxRef}>
			<button
				type="button"
				className="cc-ui-model-trigger"
				onClick={() => setOpen((v) => !v)}
				title="Змінити модель"
			>
				<span className="cc-ui-model-label">{current.label}</span>
				<ChevronDown size={14} className={open ? "cc-ui-model-chevron-open" : ""} />
			</button>

			{open && (
				<div className="cc-ui-model-dropdown" role="listbox">
					<div className="cc-ui-model-search">
						<Search size={13} />
						<input
							type="text"
							placeholder="Пошук моделі…"
							value={query}
							onChange={(e) => setQuery(e.target.value)}
							autoFocus
						/>
					</div>
					<div className="cc-ui-model-list">
						{filtered.length === 0 && (
							<div className="cc-ui-model-empty">Нічого не знайдено</div>
						)}
						{filtered.map((group) => (
							<div key={group.provider} className="cc-ui-model-group">
								<div className="cc-ui-model-group-title">{group.provider}</div>
								{group.models.map((m) => {
									const active = m.provider === current.provider && m.id === current.modelId;
									return (
										<button
											key={m.id}
											type="button"
											className={`cc-ui-model-option${active ? " cc-ui-model-option-active" : ""}`}
											onClick={() => handlePick(m.provider, m.id)}
											title={m.id}
										>
											<span className="cc-ui-model-option-label">{m.label}</span>
											{m.reasoning && <span className="cc-ui-model-tag">reasoning</span>}
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
