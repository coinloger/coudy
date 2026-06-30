import { useEffect, useState } from "react";
import { Modal } from "./Modal";

interface ChatSettings {
	autoCompact: boolean;
	compactThresholdPct: number;
}

export interface ChatSettingsModalProps {
	open: boolean;
	onClose: () => void;
}

const COMPACT_THRESHOLD_MIN = 50;
const COMPACT_THRESHOLD_MAX = 95;

/**
 * Модалка налаштувань чату. Зараз: авто-стиснення контексту
 * (toggle + відсотковий поріг). Розширювана — кожне налаштування
 * у власному .cc-settings-field, майбутні додаються аналогічно.
 */
export function ChatSettingsModal({ open, onClose }: ChatSettingsModalProps): React.ReactNode {
	const [settings, setSettings] = useState<ChatSettings>({ autoCompact: true, compactThresholdPct: 80 });
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	// Завантажити поточні налаштування при відкритті.
	useEffect(() => {
		if (!open) return;
		setError(null);
		void fetch("/api/chat-settings")
			.then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
			.then((d: ChatSettings) => setSettings(d))
			.catch(() => setError("Не вдалося завантажити налаштування"));
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

	const save = (): void => {
		setBusy(true);
		setError(null);
		fetch("/api/chat-settings", {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(settings),
		})
			.then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
			.then(() => onClose())
			.catch(() => setError("Не вдалося зберегти"))
			.finally(() => setBusy(false));
	};

	return (
		<Modal
			open={open}
			title="Налаштування чату"
			onClose={onClose}
			footer={
				<>
					<button type="button" className="btn btn-sm btn-outline-secondary" onClick={onClose} disabled={busy}>
						Скасувати
					</button>
					<button type="button" className="btn btn-sm cc-btn-accent" onClick={save} disabled={busy}>
						Зберегти
					</button>
				</>
			}
		>
			<div className="cc-settings-field">
				<div className="cc-settings-field-title">Авто-стиснення контексту</div>
				<div className="cc-settings-row">
					<div className="form-check form-switch m-0">
						<input
							id="cc-auto-compact"
							className="form-check-input"
							type="checkbox"
							role="switch"
							checked={settings.autoCompact}
							onChange={(e) => setSettings((s) => ({ ...s, autoCompact: e.target.checked }))}
						/>
						<label className="form-check-label" htmlFor="cc-auto-compact">
							Авто-стиснення при наближенні до ліміту
						</label>
					</div>
				</div>
				<div className="cc-settings-row">
					<label className="form-label small mb-1" htmlFor="cc-compact-threshold">
						Поріг: {settings.compactThresholdPct}%
					</label>
					<input
						id="cc-compact-threshold"
						type="range"
						className="form-range"
						min={COMPACT_THRESHOLD_MIN}
						max={COMPACT_THRESHOLD_MAX}
						value={settings.compactThresholdPct}
						disabled={!settings.autoCompact}
						onChange={(e) =>
							setSettings((s) => ({ ...s, compactThresholdPct: Number(e.target.value) }))
						}
					/>
					<div className="cc-settings-hint">
						Стискає контекст коли заповнено ≥{settings.compactThresholdPct}% вікна.
					</div>
				</div>
			</div>
			{error && <div className="cc-provider-error mt-2">{error}</div>}
		</Modal>
	);
}
