/**
 * Web Search Plugin — frontend entry (TSX).
 *
 * Компілюється на льоту сервером через esbuild (loader tsx, jsxFactory
 * window.React.createElement) → браузер отримує ESM-JS. React береться з
 * глобального window.React, тож JSX працює БЕЗ `import React`.
 *
 * Таба налаштувань «Web Search»: вибір пошукового рушія (Bing / DuckDuckGo).
 */

const R = window.React;
const { useState, useEffect } = R;

type Engine = "bing" | "ddg";
interface Config {
	engine: Engine;
}

/** Таба налаштувань Web Search. */
function WebSearchSettings(): React.ReactNode {
	const [engine, setEngine] = useState<Engine>("ddg");
	const [busy, setBusy] = useState(false);
	const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

	// Завантажити конфіг при монтуванні.
	useEffect(() => {
		void fetch("/api/web-search/config")
			.then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
			.then((d: Config) => {
				if (d.engine === "ddg" || d.engine === "bing") setEngine(d.engine);
			})
			.catch(() => setMsg({ ok: false, text: "Не вдалося завантажити конфіг" }));
	}, []);

	const save = (): void => {
		setBusy(true);
		setMsg(null);
		fetch("/api/web-search/config", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ engine }),
		})
			.then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
			.then(() => setMsg({ ok: true, text: "Збережено" }))
			.catch(() => setMsg({ ok: false, text: "Не вдалося зберегти" }))
			.finally(() => setBusy(false));
	};

	return (
		<div>
			<h2 className="h5 mb-3">Вебпошук</h2>
			<p className="text-muted small mb-3">
				Налаштування інструментів <code>web_search</code> та <code>browse</code>. Працює через
				локальний headless Chrome — без зовнішніх API. Оберіть пошуковий рушій за замовчуванням.
			</p>

			<div className="mb-3">
				<label className="form-label">Пошуковий рушій</label>
				<div className="form-check">
					<input
						className="form-check-input"
						type="radio"
						name="ws-engine"
						id="ws-ddg"
						checked={engine === "ddg"}
						onChange={() => setEngine("ddg")}
					/>
					<label className="form-check-label" htmlFor="ws-ddg">
						DuckDuckGo (за замовчуванням)
					</label>
				</div>
				<div className="form-check">
					<input
						className="form-check-input"
						type="radio"
						name="ws-engine"
						id="ws-bing"
						checked={engine === "bing"}
						onChange={() => setEngine("bing")}
					/>
					<label className="form-check-label" htmlFor="ws-bing">
						Bing
					</label>
				</div>
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
