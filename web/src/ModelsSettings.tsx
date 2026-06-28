import { useCallback, useEffect, useState } from "react";
import { Check, ChevronDown, ChevronRight, Plus, Trash2 } from "lucide-react";
import type { ModelEntry, ProviderGroup } from "./ModelSelector";
import { AddProviderDialog } from "./AddProviderDialog";

/** Знєднати провайдера (DELETE). */
async function disconnect(id: string): Promise<boolean> {
	const r = await fetch(`/api/providers/${encodeURIComponent(id)}`, { method: "DELETE" });
	return r.ok;
}

/** Оновити contextWindow усіх моделей custom-провайдера (PATCH). */
async function patchContextWindow(id: string, contextWindow: number): Promise<boolean> {
	const r = await fetch(`/api/providers/${encodeURIComponent(id)}`, {
		method: "PATCH",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ contextWindow }),
	});
	return r.ok;
}
function ConnectedProvider({
	group,
	removed,
	onRemoved,
	onContextWindowChanged,
}: {
	group: ProviderGroup;
	removed: boolean;
	onRemoved: (id: string) => void;
	onContextWindowChanged: (id: string) => void;
}): React.ReactNode {
	const [open, setOpen] = useState(false);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	// Inline-редагування contextWindow (тільки для custom-провайдерів).
	const firstCw = group.models[0]?.contextWindow ?? 128000;
	const [cwDraft, setCwDraft] = useState(String(firstCw));
	const [cwBusy, setCwBusy] = useState(false);
	const [cwError, setCwError] = useState<string | null>(null);

	const remove = (): void => {
		setBusy(true);
		setError(null);
		disconnect(group.provider)
			.then((ok) => (ok ? onRemoved(group.provider) : setError("Не вдалося видалити")))
			.catch(() => setError("Не вдалося видалити"))
			.finally(() => setBusy(false));
	};

	const saveCw = (): void => {
		const cw = Number(cwDraft);
		if (!cw || cw <= 0) {
			setCwError("Введіть число > 0");
			return;
		}
		setCwBusy(true);
		setCwError(null);
		patchContextWindow(group.provider, cw)
			.then((ok) => (ok ? onContextWindowChanged(group.provider) : setCwError("Не вдалося зберегти")))
			.catch(() => setCwError("Не вдалося зберегти"))
			.finally(() => setCwBusy(false));
	};

	return (
		<div className="cc-provider-row" data-configured="true">
			<div className="cc-provider-head">
				<button
					type="button"
					className="cc-provider-name cc-provider-toggle"
					onClick={() => setOpen((v) => !v)}
					title={group.models.length > 0 ? "Показати моделі" : undefined}
				>
					{open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
					{group.provider}
				</button>
				<div className="cc-provider-meta">
					<span className="cc-provider-status cc-provider-status-on">
						<Check size={13} /> <span>{group.models.length} моделей</span>
					</span>
					<button
						type="button"
						className="btn btn-sm btn-outline-danger"
						onClick={remove}
						disabled={busy}
						title="Відʼєднати"
					>
						<Trash2 size={14} />
					</button>
				</div>
			</div>
			{open && group.models.length > 0 && (
				<ul className="cc-provider-models">
					{group.models.map((m: ModelEntry) => (
						<li key={m.id} title={m.id}>
							{m.label}
							{m.reasoning && <span className="cc-provider-model-tag">reasoning</span>}
						</li>
					))}
				</ul>
			)}
			{group.custom && (
				<div className="cc-provider-cw">
					<label>Context window</label>
					<div className="d-flex gap-1 align-items-center">
						<input
							type="number"
							className="form-control form-control-sm cc-provider-cw-input"
							value={cwDraft}
							onChange={(e) => setCwDraft(e.target.value)}
							disabled={cwBusy}
							placeholder="200000"
						/>
						<button
							type="button"
							className="btn btn-sm btn-outline-secondary"
							onClick={saveCw}
							disabled={cwBusy}
						>
							Зберегти
						</button>
					</div>
					{cwError && <div className="cc-provider-error">{cwError}</div>}
				</div>
			)}
			{removed && <div className="cc-provider-success">Відʼєднано.</div>}
			{error && <div className="cc-provider-error">{error}</div>}
		</div>
	);
}

/** Таба «Моделі» — pi-флоу: підключення провайдера ключем → підтягуються його моделі. */
export default function ModelsSettings(): React.ReactNode {
	const [connected, setConnected] = useState<ProviderGroup[]>([]);
	const [addOpen, setAddOpen] = useState(false);
	const [loading, setLoading] = useState(true);

	const refresh = useCallback(() => {
		fetch("/api/models")
			.then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
			.then((d: { providers: ProviderGroup[] }) => setConnected(d.providers ?? []))
			.catch(() => undefined)
			.finally(() => setLoading(false));
	}, []);

	useEffect(() => {
		refresh();
	}, [refresh]);

	return (
		<div>
			{/* Підключені провайдери */}
			<section className="mb-4">
				<h3 className="h6 mb-2">Підключені</h3>
				{loading ? (
					<div className="text-muted small">Завантаження…</div>
				) : connected.length === 0 ? (
					<div className="cc-provider-empty">
						Жодного провайдера не підключено. Додайте нижче — моделі підтягнуться автоматично.
					</div>
				) : (
					<div className="cc-provider-list">
						{connected.map((g) => (
							<ConnectedProvider
							key={g.provider}
							group={g}
							removed={false}
							onRemoved={refresh}
							onContextWindowChanged={refresh}
						/>
						))}
					</div>
				)}
			</section>

			{/* Додати провайдера */}
			<section>
				<button
					type="button"
					className="btn btn-sm cc-btn-accent"
					onClick={() => setAddOpen(true)}
				>
					<Plus size={14} /> Додати провайдера
				</button>
			</section>

			<AddProviderDialog open={addOpen} onClose={() => setAddOpen(false)} onDone={refresh} />
		</div>
	);
}
