/**
 * Web Search Plugin — frontend entry (TSX).
 *
 * Компілюється на льоту сервером через esbuild (loader tsx, jsxFactory
 * window.React.createElement) → браузер отримує ESM-JS. React береться з
 * глобального window.React, тож JSX працює БЕЗ `import React`.
 *
 * Додає табу налаштувань «Web Search» через ui:settings-tabs: вибір backend
 * (DuckDuckGo ddgr / Tavily) + поле Tavily API-ключа.
 */

const R = window.React;
const { useState, useEffect } = R;

type Backend = "ddgr" | "tavily";
interface Config {
	backend: Backend;
	hasKey: boolean;
}

/** Таба налаштувань Web Search. */
function WebSearchSettings(): React.ReactNode {
	const [backend, setBackend] = useState<Backend>("ddgr");
	const [hasKey, setHasKey] = useState(false);
	const [tavilyKey, setTavilyKey] = useState("");
	const [busy, setBusy] = useState(false);
	const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

	// Завантажити конфіг при монтуванні.
	useEffect(() => {
		void fetch("/api/web-search/config")
			.then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
			.then((d: Config) => {
				setBackend(d.backend);
				setHasKey(!!d.hasKey);
			})
			.catch(() => setMsg({ ok: false, text: "Не вдалося завантажити конфіг" }));
	}, []);

	const save = (): void => {
		setBusy(true);
		setMsg(null);
		fetch("/api/web-search/config", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				backend,
				tavilyKey: tavilyKey || undefined,
			}),
		})
			.then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
			.then((d: Config) => {
				setHasKey(!!d.hasKey);
				setTavilyKey("");
				setMsg({ ok: true, text: "Збережено" });
			})
			.catch(() => setMsg({ ok: false, text: "Не вдалося зберегти" }))
			.finally(() => setBusy(false));
	};

	return (
		<div>
			<h2 className="h5 mb-3">Вебпошук</h2>
			<p className="text-muted small mb-3">
				Налаштування інструменту <code>web_search</code>. DuckDuckGo (через{" "}
				<code>ddgr</code>) працює без ключа; Tavily потребує API-ключа.
			</p>

			<div className="mb-3">
				<label className="form-label">Джерело пошуку</label>
				<div className="form-check">
					<input
						className="form-check-input"
						type="radio"
						name="ws-backend"
						id="ws-ddgr"
						checked={backend === "ddgr"}
						onChange={() => setBackend("ddgr")}
					/>
					<label className="form-check-label" htmlFor="ws-ddgr">
						DuckDuckGo (<code>ddgr</code>, без ключа)
					</label>
				</div>
				<div className="form-check">
					<input
						className="form-check-input"
						type="radio"
						name="ws-backend"
						id="ws-tavily"
						checked={backend === "tavily"}
						onChange={() => setBackend("tavily")}
					/>
					<label className="form-check-label" htmlFor="ws-tavily">
						Tavily (з API-ключем)
					</label>
				</div>
			</div>

			<div className="mb-3">
				<label className="form-label" htmlFor="ws-key">
					Tavily API-ключ
				</label>
				<input
					id="ws-key"
					type="password"
					className="form-control form-control-sm"
					placeholder={hasKey ? "•••• (введіть новий, щоб змінити)" : "tvly-…"}
					value={tavilyKey}
					onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTavilyKey(e.target.value)}
					autoComplete="off"
				/>
				{hasKey && (
					<div className="form-text">Ключ збережено. Залиште поле порожнім, щоб не змінювати.</div>
				)}
			</div>

			{msg && (
				<div className={`alert ${msg.ok ? "alert-success" : "alert-danger"} py-2 mb-3`}>
					{msg.text}
				</div>
			)}

			<button type="button" className="btn btn-sm cc-btn-accent" onClick={save} disabled={busy}>
				{busy ? "Збереження…" : "Зберегти"}
			</button>
		</div>
	);
}

export function activate(ctx: {
	utils: { log: (...a: unknown[]) => void };
	hooks: { addFilter: (name: string, fn: (v: unknown) => unknown) => void };
}): void {
	ctx.utils.log("frontend активовано (web-search)");

	// --- Таба налаштувань (ui:settings-tabs) ---
	ctx.hooks.addFilter("ui:settings-tabs", (tabs: unknown) => [
		...(tabs as unknown[]),
		{
			id: "web-search",
			label: "Web Search",
			render: () => <WebSearchSettings />,
		},
	]);
}

export function deactivate(ctx: { utils: { log: (...a: unknown[]) => void } }): void {
	ctx.utils.log("frontend деактивовано (web-search)");
}
