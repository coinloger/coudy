import { useEffect, useRef, useState } from "react";
import { ExternalLink } from "lucide-react";

export interface OAuthProviderInfo {
	id: string;
	name: string;
	callback: boolean;
}

interface PendingState {
	status: "pending" | "done" | "error" | "idle";
	type?: "callback" | "device";
	url?: string;
	userCode?: string;
	verificationUri?: string;
	error?: string;
}

export interface OAuthLoginProps {
	provider: OAuthProviderInfo;
	onDone: () => void;
	onBack: () => void;
}

/**
 * OAuth-логін: POST /oauth/start → (callback) кнопка «Відкрити» + очікування,
 * (device) показати userCode + verificationUri. Поллить /oauth/poll → onDone.
 */
export function OAuthLogin({ provider, onDone, onBack }: OAuthLoginProps): React.ReactNode {
	const [pending, setPending] = useState<PendingState | null>(null);
	const [error, setError] = useState<string | null>(null);
	const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	const stopPoll = (): void => {
		if (pollRef.current) {
			clearTimeout(pollRef.current);
			pollRef.current = null;
		}
	};

	const start = (): void => {
		setError(null);
		setPending(null);
		fetch(`/api/providers/${encodeURIComponent(provider.id)}/oauth/start`, { method: "POST" })
			.then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
			.then((data: PendingState) => setPending(data))
			.catch(() => setError("Не вдалося почати авторизацію"));
	};

	// Poll статусу, поки pending.
	useEffect(() => {
		if (!pending || pending.status !== "pending") return;
		const poll = (): void => {
			fetch(`/api/providers/${encodeURIComponent(provider.id)}/oauth/poll`)
				.then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
				.then((s: PendingState) => {
					setPending(s);
					if (s.status === "done") {
						stopPoll();
						onDone();
					} else if (s.status === "error") {
						stopPoll();
						setError(s.error ?? "Помилка авторизації");
					} else if (s.status === "pending") {
						pollRef.current = setTimeout(poll, 1500);
					}
				})
				.catch(() => {
					pollRef.current = setTimeout(poll, 1500);
				});
		};
		pollRef.current = setTimeout(poll, 1500);
		return stopPoll;
	}, [pending?.status, provider.id, onDone]);

	// Скасувати при розмонтуванні.
	useEffect(() => {
		return () => {
			stopPoll();
			if (provider.id) {
				fetch(`/api/oauth/pending/${encodeURIComponent(provider.id)}`, { method: "DELETE" }).catch(
					() => undefined,
				);
			}
		};
	}, [provider.id]);

	const isCallback = pending?.type === "callback";

	return (
		<div>
			<div className="cc-oauth-provider">{provider.name}</div>

			{!pending && !error && (
				<button type="button" className="btn btn-sm cc-btn-accent" onClick={start}>
					Почати авторизацію
				</button>
			)}

			{pending && pending.status === "pending" && (
				<div className="cc-oauth-pending">
					{isCallback && pending.url && (
						<>
							<p className="cc-oauth-hint">Відкрийте сторінку авторизації та дозвольте доступ:</p>
							<a
								href={pending.url}
								target="_blank"
								rel="noopener noreferrer"
								className="btn btn-sm cc-btn-accent"
							>
								<ExternalLink size={14} /> Відкрити {new URL(pending.url).host}
							</a>
						</>
					)}
					{!isCallback && (
						<>
							<p className="cc-oauth-hint">
								Відкрийте посилання та введіть код:
							</p>
							{pending.verificationUri && (
								<a
									href={pending.verificationUri}
									target="_blank"
									rel="noopener noreferrer"
									className="cc-oauth-devicelink"
								>
									<ExternalLink size={13} /> {pending.verificationUri}
								</a>
							)}
							{pending.userCode && <div className="cc-oauth-code">{pending.userCode}</div>}
						</>
					)}
					<div className="cc-oauth-waiting">Очікую авторизацію…</div>
				</div>
			)}

			{error && <div className="cc-provider-error">{error}</div>}

			<div className="cc-modal-actions">
				<button type="button" className="btn btn-sm btn-outline-secondary" onClick={onBack}>
					Назад
				</button>
			</div>
		</div>
	);
}
