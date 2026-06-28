import { useCallback, useEffect, useState } from "react";
import { Puzzle } from "lucide-react";
import type { ApiPlugin, ApiPluginsResponse } from "./types";

export default function PluginManager(): React.ReactNode {
	const [plugins, setPlugins] = useState<ApiPlugin[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [toggling, setToggling] = useState<Record<string, boolean>>({});

	const refresh = useCallback(async () => {
		try {
			const res = await fetch("/api/plugins");
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const data: ApiPluginsResponse = await res.json();
			setPlugins(data.plugins ?? []);
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		void refresh();
	}, [refresh]);

	/** Увімкнути/вимкнути плагін (POST enable/disable) + рефреш списку. */
	const toggle = async (plugin: ApiPlugin): Promise<void> => {
		if (toggling[plugin.name]) return;
		setToggling((prev) => ({ ...prev, [plugin.name]: true }));
		setError(null);
		// Оптимістично: одразу міняємо стан для UI-відгуку.
		setPlugins((prev) =>
			prev.map((p) =>
				p.name === plugin.name ? { ...p, enabled: !p.enabled, active: !p.enabled } : p,
			),
		);
		try {
			const res = await fetch(
				`/api/plugins/${encodeURIComponent(plugin.name)}/${plugin.enabled ? "disable" : "enable"}`,
				{ method: "POST" },
			);
			if (!res.ok) {
				const j = (await res.json().catch(() => null)) as { error?: string } | null;
				throw new Error(j?.error ?? `HTTP ${res.status}`);
			}
			// Синхронізуємо реальний стан з сервера.
			await refresh();
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
			// Відкат оптимістичного стану.
			await refresh();
		} finally {
			setToggling((prev) => {
				const next = { ...prev };
				delete next[plugin.name];
				return next;
			});
		}
	};

	return (
		<div className="p-4">
			<h2 className="h4 mb-4">Плагіни</h2>

			{loading && (
				<div className="d-flex align-items-center gap-2 text-muted">
					<span className="spinner-border spinner-border-sm" role="status" />
					Завантаження…
				</div>
			)}

			{error && (
				<div className="alert alert-danger" role="alert">
					{error}
				</div>
			)}

			{!loading && !error && plugins.length === 0 && (
				<p className="text-muted">Плагінів не знайдено.</p>
			)}

			{!loading && !error && plugins.length > 0 && (
				<div className="row g-3">
					{plugins.map((p) => {
						const busy = !!toggling[p.name];
						return (
							<div className="col-md-6 col-lg-4" key={p.name}>
								<div
									className={`card border-0 shadow-sm h-100 ${p.enabled ? "" : "opacity-50"}`}
								>
									<div className="card-body">
										<div className="d-flex align-items-start justify-content-between mb-2">
											<div className="d-flex align-items-center gap-2">
												<Puzzle size={20} className="text-primary" />
												<h6 className="card-title mb-0">{p.title}</h6>
											</div>
											{/* Toggle-перемикач enable/disable */}
											<button
												type="button"
												className="cc-plugin-toggle btn p-0 lh-1 border-0"
												onClick={() => void toggle(p)}
												disabled={busy}
												title={p.enabled ? "Вимкнути" : "Увімкнути"}
												aria-pressed={p.enabled}
												aria-label={p.enabled ? "Вимкнути плагін" : "Увімкнути плагін"}
											>
												<span className={`cc-toggle ${p.enabled ? "cc-toggle-on" : "cc-toggle-off"}`}>
													<span className="cc-toggle-knob" />
												</span>
											</button>
										</div>
										<p className="card-text text-muted small mb-2">{p.description}</p>
										<div className="d-flex align-items-center gap-2 text-muted small">
											<span className="badge bg-light text-dark border">v{p.version}</span>
											<code className="text-muted">{p.name}</code>
											<span className={`badge ${p.active ? "bg-success" : "bg-secondary"} ms-auto`}>
												{p.active ? "активний" : "вимкнено"}
											</span>
										</div>
									</div>
								</div>
							</div>
						);
					})}
				</div>
			)}
		</div>
	);
}
