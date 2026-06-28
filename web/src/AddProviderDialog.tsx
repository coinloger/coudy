import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { OAuthLogin, type OAuthProviderInfo } from "./OAuthLogin";

type ApiType = "anthropic-messages" | "openai-completions" | "openai-responses";

type Branch = "openai" | "anthropic" | "custom" | "subscription";

export interface FetchedModel {
	id: string;
	name?: string;
	/** Реальний contextWindow з /v1/models (meta.context_length), якщо провайдер віддав. */
	contextWindow?: number;
}

export interface AddProviderDialogProps {
	open: boolean;
	onClose: () => void;
	/** Після успішного підключення/збереження. */
	onDone: () => void;
}

const API_LABEL: Record<ApiType, string> = {
	"anthropic-messages": "Anthropic-сумісний",
	"openai-completions": "OpenAI-сумісний",
	"openai-responses": "OpenAI Responses",
};

/** Діалог «Додати провайдера» — 3 гілки: пресет OpenAI / пресет Anthropic / Custom. */
export function AddProviderDialog({ open, onClose, onDone }: AddProviderDialogProps): React.ReactNode {
	const [branch, setBranch] = useState<Branch | null>(null);
	const [oauthProviders, setOauthProviders] = useState<OAuthProviderInfo[]>([]);
	const [oauthPick, setOauthPick] = useState<OAuthProviderInfo | null>(null);
	const [apiKey, setApiKey] = useState("");
	const [label, setLabel] = useState("");
	const [baseUrl, setBaseUrl] = useState("");
	const [apiType, setApiType] = useState<ApiType>("openai-completions");
	const [providerId, setProviderId] = useState("");
	const [models, setModels] = useState<FetchedModel[]>([]);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	// Скидання стану при відкритті.
	useEffect(() => {
		if (open) {
			setBranch(null);
			setApiKey("");
			setLabel("");
			setBaseUrl("");
			setApiType("openai-completions");
			setProviderId("");
			setModels([]);
			setBusy(false);
			setError(null);
			setOauthPick(null);
			void fetch("/api/oauth/providers")
				.then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
				.then((d: { providers: OAuthProviderInfo[] }) => setOauthProviders(d.providers ?? []))
				.catch(() => undefined);
		}
	}, [open]);

	// Escape-закриття.
	useEffect(() => {
		if (!open) return;
		const onKey = (e: KeyboardEvent): void => {
			if (e.key === "Escape") onClose();
		};
		document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
	}, [open, onClose]);

	if (!open) return null;

	const reset = (): void => {
		setBusy(false);
		setError(null);
	};

	// Пресет (OpenAI/Anthropic): лише ключ → POST /api/providers/preset.
	const submitPreset = (provider: "openai" | "anthropic"): void => {
		if (!apiKey.trim()) return;
		setBusy(true);
		setError(null);
		fetch("/api/providers/preset", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ provider, apiKey: apiKey.trim() }),
		})
			.then((r) => (r.ok ? onClose() : Promise.reject(r.status)))
			.then(() => onDone())
			.catch(() => setError("Не вдалося підключити"))
			.finally(() => setBusy(false));
	};

	// Custom: отримати моделі з {baseUrl}/v1/models.
	const fetchModels = (): void => {
		if (!baseUrl.trim() || !apiKey.trim()) return;
		setBusy(true);
		setError(null);
		fetch(`/api/providers/${encodeURIComponent(providerId.trim() || "preview")}/models/fetch`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ baseUrl: baseUrl.trim(), apiKey: apiKey.trim(), apiType }),
		})
			.then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
			.then((data: { models?: FetchedModel[]; error?: string }) => {
				if (data.error) {
					setError(data.error);
					setModels([]);
				} else {
					setModels(data.models ?? []);
				}
			})
			.catch(() => setError("Не вдалося отримати моделі"))
			.finally(() => setBusy(false));
	};

	// Custom: зберегти провайдера (POST /api/providers/custom).
	const saveCustom = (): void => {
		const id = providerId.trim();
		if (!id || !baseUrl.trim() || !apiKey.trim()) {
			setError("Заповніть назву, baseUrl та ключ");
			return;
		}
		setBusy(true);
		setError(null);
		fetch("/api/providers/custom", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				id,
				label: label.trim() || undefined,
				apiType,
				baseUrl: baseUrl.trim(),
				apiKey: apiKey.trim(),
				models,
			}),
		})
			.then((r) => (r.ok ? onClose() : Promise.reject(r.status)))
			.then(() => onDone())
			.catch(() => setError("Не вдалося зберегти"))
			.finally(() => setBusy(false));
	};

	return (
		<div className="cc-modal-backdrop" onClick={onClose}>
			<div className="cc-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
				<div className="cc-modal-head">
					<span className="cc-modal-title">Додати провайдера</span>
					<button type="button" className="cc-modal-close" onClick={onClose} aria-label="Закрити">
						<X size={16} />
					</button>
				</div>

				<div className="cc-modal-body">
					{branch === null && (
						<div className="cc-add-branches">
							<button type="button" className="cc-add-branch" onClick={() => setBranch("openai")}>
								<strong>OpenAI</strong>
								<span className="text-muted">пресет — лише API-ключ</span>
							</button>
							<button type="button" className="cc-add-branch" onClick={() => setBranch("anthropic")}>
								<strong>Anthropic</strong>
								<span className="text-muted">пресет — лише API-ключ</span>
							</button>
							<button type="button" className="cc-add-branch" onClick={() => setBranch("custom")}>
								<strong>Custom</strong>
								<span className="text-muted">Anthropic/OpenAI-сумісний + baseUrl + моделі</span>
							</button>
							{oauthProviders.length > 0 && (
								<button type="button" className="cc-add-branch" onClick={() => setBranch("subscription")}>
									<strong>Увійти через підписку</strong>
									<span className="text-muted">Claude Pro/Max, Copilot, Codex (OAuth)</span>
								</button>
							)}
						</div>
					)}

					{branch === "openai" && (
						<PresetForm
							name="OpenAI"
							apiKey={apiKey}
							setApiKey={setApiKey}
							busy={busy}
							error={error}
							onBack={reset}
							onSubmit={() => submitPreset("openai")}
						/>
					)}
					{branch === "anthropic" && (
						<PresetForm
							name="Anthropic"
							apiKey={apiKey}
							setApiKey={setApiKey}
							busy={busy}
							error={error}
							onBack={reset}
							onSubmit={() => submitPreset("anthropic")}
						/>
					)}

					{branch === "custom" && (
						<div>
							<div className="cc-field">
								<label>Тип API</label>
								<select
									className="form-select form-select-sm"
									value={apiType}
									onChange={(e) => setApiType(e.target.value as ApiType)}
									disabled={busy}
								>
									<option value="openai-completions">{API_LABEL["openai-completions"]}</option>
									<option value="openai-responses">{API_LABEL["openai-responses"]}</option>
									<option value="anthropic-messages">{API_LABEL["anthropic-messages"]}</option>
								</select>
							</div>
							<div className="cc-field">
								<label>Назва (id)</label>
								<input
									type="text"
									className="form-control form-control-sm"
									placeholder="напр. my-proxy"
									value={providerId}
									onChange={(e) => setProviderId(e.target.value)}
									disabled={busy}
								/>
							</div>
							<div className="cc-field">
								<label>Label (необовʼязково)</label>
								<input
									type="text"
									className="form-control form-control-sm"
									placeholder="My Proxy"
									value={label}
									onChange={(e) => setLabel(e.target.value)}
									disabled={busy}
								/>
							</div>
							<div className="cc-field">
								<label>Base URL</label>
								<input
									type="text"
									className="form-control form-control-sm"
									placeholder="https://api.example.com"
									value={baseUrl}
									onChange={(e) => setBaseUrl(e.target.value)}
									disabled={busy}
								/>
							</div>
							<div className="cc-field">
								<label>API-ключ</label>
								<input
									type="password"
									className="form-control form-control-sm"
									placeholder="sk-…"
									value={apiKey}
									onChange={(e) => setApiKey(e.target.value)}
									disabled={busy}
									autoComplete="off"
								/>
							</div>

						<div className="d-flex gap-2 mb-2">
								<button
									type="button"
									className="btn btn-sm btn-outline-secondary"
									onClick={fetchModels}
									disabled={busy || !baseUrl.trim() || !apiKey.trim()}
								>
									Отримати моделі
								</button>
							</div>

							{models.length > 0 && (
								<div className="cc-fetched-models">
									<div className="cc-fetched-title">Знайдено моделей: {models.length}</div>
									<ul>
										{models.map((m) => (
											<li key={m.id}>{m.name ?? m.id}</li>
										))}
									</ul>
								</div>
							)}

							{error && <div className="cc-provider-error">{error}</div>}

							<div className="cc-modal-actions">
								<button type="button" className="btn btn-sm btn-outline-secondary" onClick={reset} disabled={busy}>
									Назад
								</button>
								<button type="button" className="btn btn-sm cc-btn-accent" onClick={saveCustom} disabled={busy}>
									Зберегти
								</button>
							</div>
						</div>
					)}

				{branch === "subscription" &&
					(oauthPick ? (
						<OAuthLogin
							provider={oauthPick}
							onDone={() => {
								setOauthPick(null);
								onClose();
								onDone();
							}}
							onBack={() => setOauthPick(null)}
						/>
					) : (
						<div>
							<div className="cc-oauth-pick">
								{oauthProviders.map((p) => (
									<button
										key={p.id}
										type="button"
										className="cc-add-branch"
										onClick={() => setOauthPick(p)}
									>
										<strong>{p.name}</strong>
										<span className="text-muted">{p.callback ? "через браузер" : "device code"}</span>
									</button>
								))}
							</div>
							<div className="cc-modal-actions">
								<button type="button" className="btn btn-sm btn-outline-secondary" onClick={reset}>
									Назад
								</button>
							</div>
						</div>
					))}
				</div>
			</div>
		</div>
	);
}

/** Форма пресету (OpenAI/Anthropic): лише ключ → підключити. */
function PresetForm({
	name,
	apiKey,
	setApiKey,
	busy,
	error,
	onBack,
	onSubmit,
}: {
	name: string;
	apiKey: string;
	setApiKey: (v: string) => void;
	busy: boolean;
	error: string | null;
	onBack: () => void;
	onSubmit: () => void;
}): React.ReactNode {
	return (
		<div>
			<div className="cc-field">
				<label>{name} API-ключ</label>
				<input
					type="password"
					className="form-control form-control-sm"
					placeholder="sk-…"
					value={apiKey}
					onChange={(e) => setApiKey(e.target.value)}
					disabled={busy}
					autoComplete="off"
				/>
			</div>
			{error && <div className="cc-provider-error">{error}</div>}
			<div className="cc-modal-actions">
				<button type="button" className="btn btn-sm btn-outline-secondary" onClick={onBack} disabled={busy}>
					Назад
				</button>
				<button type="button" className="btn btn-sm cc-btn-accent" onClick={onSubmit} disabled={busy || !apiKey.trim()}>
					Підключити
				</button>
			</div>
		</div>
	);
}
