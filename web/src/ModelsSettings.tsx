import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, ChevronDown, ChevronRight, Search, Trash2 } from "lucide-react";
import type { ModelEntry, ProviderGroup } from "./playground/ModelSelector";

/** Запис провайдера з бекенду (GET /api/providers — увесь каталог + статус). */
interface ProviderInfo {
	id: string;
	envVar: string | null;
	status: { configured: boolean; source?: "stored" | "environment"; label?: string };
}

/** Знєднати провайдера (DELETE) і повідомити батьків для рефетчу. */
async function disconnect(id: string): Promise<boolean> {
	const r = await fetch(`/api/providers/${encodeURIComponent(id)}`, { method: "DELETE" });
	return r.ok;
}

/** Підключити провайдера ключем (POST key). */
async function connect(id: string, key: string): Promise<boolean> {
	const r = await fetch(`/api/providers/${encodeURIComponent(id)}/key`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ key }),
	});
	return r.ok;
}

/** Карта підключеного провайдера: імʼя, ✓, кількість моделей, список (expandable), «Видалити». */
function ConnectedProvider({
	group,
	removed,
	onRemoved,
}: {
	group: ProviderGroup;
	removed: boolean;
	onRemoved: (id: string) => void;
}): React.ReactNode {
	const [open, setOpen] = useState(false);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const remove = (): void => {
		setBusy(true);
		setError(null);
		disconnect(group.provider)
			.then((ok) => (ok ? onRemoved(group.provider) : setError("Не вдалося видалити")))
			.catch(() => setError("Не вдалося видалити"))
			.finally(() => setBusy(false));
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
			{removed && <div className="cc-provider-success">Відʼєднано.</div>}
			{error && <div className="cc-provider-error">{error}</div>}
		</div>
	);
}

/** Рядок доступного провайдера з інлайн-формою підключення. */
function AvailableProvider({
	provider,
	onConnected,
}: {
	provider: ProviderInfo;
	onConnected: (id: string) => void;
}): React.ReactNode {
	const [open, setOpen] = useState(false);
	const [key, setKey] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const submit = (): void => {
		if (!key.trim()) return;
		setBusy(true);
		setError(null);
		connect(provider.id, key.trim())
			.then((ok) => (ok ? onConnected(provider.id) : setError("Не вдалося підключити")))
			.catch(() => setError("Не вдалося підключити"))
			.finally(() => setBusy(false));
	};

	return (
		<div className="cc-provider-row cc-provider-available">
			<div className="cc-provider-head">
				<button
					type="button"
					className="cc-provider-name cc-provider-toggle"
					onClick={() => setOpen((v) => !v)}
				>
					{open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
					{provider.id}
				</button>
				{provider.envVar && (
					<span className="cc-provider-envhint">env {provider.envVar}</span>
				)}
			</div>
			{open && (
				<div className="cc-provider-form">
					<input
						type="password"
						className="form-control form-control-sm cc-provider-input"
						placeholder="API-ключ"
						value={key}
						onChange={(e) => setKey(e.target.value)}
						disabled={busy}
						autoComplete="off"
					/>
					<button
						type="button"
						className="btn btn-sm cc-btn-accent"
						onClick={submit}
						disabled={busy || !key.trim()}
					>
						Підключити
					</button>
				</div>
			)}
			{error && <div className="cc-provider-error">{error}</div>}
		</div>
	);
}

/** Таба «Моделі» — pi-флоу: підключення провайдера ключем → підтягуються його моделі. */
export default function ModelsSettings(): React.ReactNode {
	const [connected, setConnected] = useState<ProviderGroup[]>([]);
	const [all, setAll] = useState<ProviderInfo[]>([]);
	const [query, setQuery] = useState("");
	const [loading, setLoading] = useState(true);

	const refresh = useCallback(() => {
		const pModels = fetch("/api/models")
			.then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
			.then((d: { providers: ProviderGroup[] }) => setConnected(d.providers ?? []))
			.catch(() => undefined);
		const pProviders = fetch("/api/providers")
			.then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
			.then((d: { providers: ProviderInfo[] }) => setAll(d.providers ?? []))
			.catch(() => undefined);
		Promise.all([pModels, pProviders]).finally(() => setLoading(false));
	}, []);

	useEffect(() => {
		refresh();
	}, [refresh]);

	// Доступні = не підключені ключем (source !== "stored").
	const connectedIds = useMemo(() => new Set(connected.map((g) => g.provider)), [connected]);
	const available = useMemo(() => {
		const notStored = all.filter((p) => p.status.source !== "stored");
		const q = query.trim().toLowerCase();
		const filtered = q
			? notStored.filter(
					(p) => p.id.toLowerCase().includes(q) || (p.envVar ?? "").toLowerCase().includes(q),
				)
			: notStored;
		return filtered;
	}, [all, connectedIds, query]);

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
							<ConnectedProvider key={g.provider} group={g} removed={false} onRemoved={refresh} />
						))}
					</div>
				)}
			</section>

			{/* Додати провайдера */}
			<section>
				<h3 className="h6 mb-2">Додати провайдера</h3>
				<div className="cc-provider-search mb-2">
					<Search size={14} />
					<input
						type="text"
						className="form-control form-control-sm"
						placeholder="Пошук серед доступних провайдерів…"
						value={query}
						onChange={(e) => setQuery(e.target.value)}
					/>
				</div>
				{!loading && available.length === 0 ? (
					<div className="text-muted small">
						{query ? "Нічого не знайдено" : "Усі провайдери вже підключені"}
					</div>
				) : (
					<div className="cc-provider-list">
						{available.map((p) => (
							<AvailableProvider key={p.id} provider={p} onConnected={refresh} />
						))}
					</div>
				)}
			</section>
		</div>
	);
}
