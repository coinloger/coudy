import { useEffect, useMemo, useState } from "react";
import { Check, CircleAlert, Search, Trash2 } from "lucide-react";

/** Запис провайдера з бекенду (GET /api/providers). */
interface ProviderInfo {
	id: string;
	envVar: string | null;
	status: { configured: boolean; source?: "stored" | "environment"; label?: string };
}

/** Маска ключа для підказки — значення НІКОЛИ не показуємо. */
function statusHint(status: ProviderInfo["status"]): string {
	if (status.source === "environment" && status.label) return `через env ${status.label}`;
	if (status.configured) return "ключ збережено";
	return "не налаштовано";
}

/** Рядок одного провайдера: статус + форма підключення (API-ключ). */
function ProviderRow({
	provider,
	onSaved,
	onRemoved,
}: {
	provider: ProviderInfo;
	onSaved: (id: string) => void;
	onRemoved: (id: string) => void;
}): React.ReactNode {
	const [key, setKey] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const configured = provider.status.configured;

	const save = (): void => {
		if (!key.trim()) return;
		setBusy(true);
		setError(null);
		fetch(`/api/providers/${encodeURIComponent(provider.id)}/key`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ key: key.trim() }),
		})
			.then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
			.then(() => {
				setKey("");
				onSaved(provider.id);
			})
			.catch(() => setError("Не вдалося зберегти"))
			.finally(() => setBusy(false));
	};

	const remove = (): void => {
		setBusy(true);
		setError(null);
		fetch(`/api/providers/${encodeURIComponent(provider.id)}`, { method: "DELETE" })
			.then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
			.then(() => onRemoved(provider.id))
			.catch(() => setError("Не вдалося видалити"))
			.finally(() => setBusy(false));
	};

	return (
		<div className="cc-provider-row" data-configured={configured}>
			<div className="cc-provider-head">
				<div className="cc-provider-name">{provider.id}</div>
				<div className={`cc-provider-status cc-provider-status-${configured ? "on" : "off"}`}>
					{configured ? <Check size={13} /> : <CircleAlert size={13} />}
					<span>{statusHint(provider.status)}</span>
				</div>
			</div>
			{provider.envVar && !configured && (
				<div className="cc-provider-envhint">або задайте env {provider.envVar}</div>
			)}
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
					onClick={save}
					disabled={busy || !key.trim()}
				>
					Зберегти
				</button>
				{configured && (
					<button
						type="button"
						className="btn btn-sm btn-outline-danger"
						onClick={remove}
						disabled={busy}
						title="Видалити ключ"
					>
						<Trash2 size={14} />
					</button>
				)}
			</div>
			{error && <div className="cc-provider-error">{error}</div>}
		</div>
	);
}

/** Таба «Моделі» — підключення провайдерів через API-ключ. */
export default function ModelsSettings(): React.ReactNode {
	const [providers, setProviders] = useState<ProviderInfo[]>([]);
	const [query, setQuery] = useState("");
	const [loading, setLoading] = useState(true);

	const refresh = (): void => {
		fetch("/api/providers")
			.then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
			.then((data: { providers: ProviderInfo[] }) => setProviders(data.providers ?? []))
			.catch(() => undefined)
			.finally(() => setLoading(false));
	};

	useEffect(() => {
		refresh();
	}, []);

	// Після save/delete — оновити статус лише цього провайдера (легший рефетч статусу).
	const patchStatus = (id: string): void => {
		fetch(`/api/providers/${encodeURIComponent(id)}/status`)
			.then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
			.then((status: ProviderInfo["status"]) => {
				setProviders((prev) =>
					prev.map((p) => (p.id === id ? { ...p, status } : p)),
				);
			})
			.catch(() => undefined);
	};

	const filtered = useMemo(() => {
		const q = query.trim().toLowerCase();
		if (!q) return providers;
		return providers.filter(
			(p) => p.id.toLowerCase().includes(q) || (p.envVar ?? "").toLowerCase().includes(q),
		);
	}, [providers, query]);

	const configuredCount = providers.filter((p) => p.status.configured).length;

	return (
		<div>
			<div className="d-flex align-items-center justify-content-between gap-3 flex-wrap mb-3">
				<div>
					<h3 className="h5 mb-0">Провайдери моделей</h3>
					<span className="text-muted small">
						Налаштовано: {configuredCount} з {providers.length}
					</span>
				</div>
				<div className="cc-provider-search">
					<Search size={14} />
					<input
						type="text"
						className="form-control form-control-sm"
						placeholder="Пошук провайдера…"
						value={query}
						onChange={(e) => setQuery(e.target.value)}
					/>
				</div>
			</div>

			{loading ? (
				<div className="text-muted small">Завантаження…</div>
			) : filtered.length === 0 ? (
				<div className="text-muted small">Нічого не знайдено</div>
			) : (
				<div className="cc-provider-list">
					{filtered.map((p) => (
						<ProviderRow
							key={p.id}
							provider={p}
							onSaved={patchStatus}
							onRemoved={patchStatus}
						/>
					))}
				</div>
			)}
		</div>
	);
}
