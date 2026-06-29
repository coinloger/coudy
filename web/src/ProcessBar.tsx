import { useCallback, useEffect, useRef, useState } from "react";
import { Activity, Square, Trash2, X } from "lucide-react";

/** Запис живого процесу (GET /api/processes). */
export interface AgentProcess {
	pid: number;
	pgid: number;
	command: string;
	cwd: string;
	startedAt: number;
	sessionId: string;
	status: "running" | "background" | "killed";
	ageMs: number;
}

const POLL_MS = 3000;

/** Скоротити довгу команду. */
function truncate(s: string, max: number): string {
	return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

/** Вік процесу у короткому вигляді (напр. 12s, 3m). */
function formatAge(ms: number): string {
	const s = Math.round(ms / 1000);
	if (s < 60) return `${s}s`;
	const m = Math.floor(s / 60);
	const rest = s % 60;
	return rest ? `${m}m ${rest}s` : `${m}m`;
}

export interface ProcessBarProps {
	/** Розкривати панель вгору від індикатора (дефолт true). */
	className?: string;
}

/**
 * ProcessBar: індикатор активних процесів агента над полем вводу.
 * Прихований, коли 0 процесів. Клік → popover ВГОРУ зі списком + kill.
 * Полл GET /api/processes кожні ~3с (коли є процеси або panel відкритий).
 */
export function ProcessBar(props: ProcessBarProps): React.ReactNode {
	const [processes, setProcesses] = useState<AgentProcess[]>([]);
	const [open, setOpen] = useState(false);
	const [busy, setBusy] = useState(false);
	const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
	const stoppedRef = useRef(false);

	const refresh = useCallback(async (): Promise<void> => {
		try {
			const r = await fetch("/api/processes");
			if (!r.ok) return;
			const data = (await r.json()) as { processes: AgentProcess[] };
			if (!stoppedRef.current) setProcesses(data.processes ?? []);
		} catch {
			/* сервер міг бути недоступний */
		}
	}, []);

	// Полл: постійно коли panel відкритий; інакше лише коли є процеси.
	useEffect(() => {
		stoppedRef.current = false;
		void refresh();

		const schedule = (): void => {
			if (timerRef.current) clearTimeout(timerRef.current);
			timerRef.current = setTimeout(async () => {
				await refresh();
				if (!stoppedRef.current) schedule();
			}, POLL_MS);
		};
		schedule();

		return (): void => {
			stoppedRef.current = true;
			if (timerRef.current) clearTimeout(timerRef.current);
		};
	}, [refresh]);

	const killOne = useCallback(
		async (pid: number): Promise<void> => {
			setBusy(true);
			try {
				await fetch(`/api/processes/${pid}/kill`, { method: "POST" });
			} finally {
				await refresh();
				setBusy(false);
			}
		},
		[refresh],
	);

	const killAll = useCallback(async (): Promise<void> => {
		setBusy(true);
		try {
			await fetch("/api/processes/kill-all", { method: "POST" });
		} finally {
			await refresh();
			setBusy(false);
		}
	}, [refresh]);

	const count = processes.length;
	// Прихований, коли 0 процесів (навіть якщо panel відкритий — закриваємо).
	if (count === 0) return null;

	const running = processes.filter((p) => p.status === "running").length;
	const background = count - running;

	return (
		<div className={`cc-procbar ${props.className ?? ""}`}>
			{open && (
				<div className="cc-procbar-panel">
					<div className="cc-procbar-panel-head">
						<span className="small fw-semibold">Процеси агента ({count})</span>
						<button
							type="button"
							className="btn btn-sm btn-link p-0 ms-auto"
							onClick={() => setOpen(false)}
							title="Закрити"
						>
							<X size={14} />
						</button>
					</div>
					<div className="cc-procbar-list">
						{processes.map((p) => (
							<div key={p.pid} className="cc-procbar-row">
								<span
									className={`cc-procbar-dot cc-procbar-dot-${p.status}`}
									title={p.status}
								/>
								<div className="cc-procbar-row-main">
									<div className="cc-procbar-cmd text-truncate" title={p.command}>
										{truncate(p.command, 70)}
									</div>
									<div className="cc-procbar-meta text-muted">
										pid {p.pid} · {formatAge(p.ageMs)} · {p.status}
									</div>
								</div>
								<button
									type="button"
									className="btn btn-sm btn-outline-danger cc-procbar-kill"
									onClick={() => void killOne(p.pid)}
									disabled={busy}
									title="Вбити процес"
								>
									<Trash2 size={13} />
								</button>
							</div>
						))}
					</div>
					<div className="cc-procbar-panel-foot">
						<button
							type="button"
							className="btn btn-sm btn-outline-danger w-100"
							onClick={() => void killAll()}
							disabled={busy}
						>
							<Square size={13} /> Вбити всі ({count})
						</button>
					</div>
				</div>
			)}
			<button
				type="button"
				className="cc-procbar-indicator"
				onClick={() => setOpen((v) => !v)}
				title={`${count} процесів (running: ${running}, фон: ${background})`}
			>
				<Activity size={13} />
				<span>{count} процес{count === 1 ? "" : "ів"}</span>
				{running > 0 && <span className="cc-procbar-pulse" />}
			</button>
		</div>
	);
}
