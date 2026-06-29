/**
 * Реєстр процесів агента: трекає всі процеси, спавнені через bash-тулз
 * (вкл. фонні `&`), щоб запобігти появі сиріт та дати UI/API контроль над ними.
 *
 * Singleton: один реєстр на весь сервер. Заповнюється spawnHook-ами bash-тулза.
 */
import { killProcessTree } from "@coudycode/tools";

export type ProcessStatus = "running" | "background" | "killed";

export interface ProcessEntry {
	pid: number;
	pgid: number;
	command: string;
	cwd: string;
	startedAt: number;
	sessionId: string;
	status: ProcessStatus;
}

export interface ProcessView {
	pid: number;
	pgid: number;
	command: string;
	cwd: string;
	startedAt: number;
	sessionId: string;
	status: ProcessStatus;
	/** Вік процесу в мілісекундах (на момент виклику list). */
	ageMs: number;
}

/**
 * Перевірити, чи жива процесна група (хоча б один процес).
 * pgid = лідер групи; на Unix detached:true → pgid=pid.
 */
export function isProcessGroupAlive(pgid: number): boolean {
	if (!Number.isFinite(pgid) || pgid <= 0) return false;
	try {
		process.kill(-pgid, 0);
		return true;
	} catch {
		return false;
	}
}

/**
 * Singleton-реєстр процесів. Ключ — pid (ідентичний pgid лідера на Unix).
 * list() фільтрує мертві процеси + прибирає їх з реєстру (lazy GC).
 */
export class ProcessRegistry {
	private readonly entries = new Map<number, ProcessEntry>();

	/** Зареєструвати новий процес (викликається з onSpawn bash-хука). */
	register(entry: ProcessEntry): void {
		this.entries.set(entry.pid, entry);
	}

	/**
	 * Анти-сирота: після завершення bash-команди перевірити процесну групу.
	 * Жива група → фонова `&` команда (status "background", лишається).
	 * Мертва → прибрати з реєстру.
	 */
	markBackgroundIfAlive(pid: number): void {
		const e = this.entries.get(pid);
		if (!e) return;
		if (isProcessGroupAlive(e.pgid)) {
			e.status = "background";
		} else {
			this.entries.delete(pid);
		}
	}

	/** Прибрати процес з реєстру (без вбивства). */
	remove(pid: number): void {
		this.entries.delete(pid);
	}

	/**
	 * Список лише ЖИВИХ процесів. Мертві прибираються з реєстру (lazy GC).
	 * Сортування: спочатку running, потім background; однаковий статус — за startedAt.
	 */
	list(): ProcessView[] {
		const now = Date.now();
		const alive: ProcessView[] = [];
		for (const [pid, e] of this.entries) {
			if (isProcessGroupAlive(e.pgid)) {
				alive.push({ ...e, ageMs: now - e.startedAt });
			} else {
				this.entries.delete(pid);
			}
		}
		alive.sort((a, b) => {
			const rank = (s: ProcessStatus): number => (s === "running" ? 0 : 1);
			if (rank(a.status) !== rank(b.status)) return rank(a.status) - rank(b.status);
			return a.startedAt - b.startedAt;
		});
		return alive;
	}

	/** Вбити одне дерево процесів (killProcessTree = вся процесна група). */
	kill(pid: number): boolean {
		const e = this.entries.get(pid);
		if (!e) return false;
		if (isProcessGroupAlive(e.pgid)) {
			killProcessTree(e.pgid);
		}
		e.status = "killed";
		this.entries.delete(pid);
		return true;
	}

	/** Вбити всі живі процеси (shutdown-handler / кнопка «Вбити всі»). */
	killAll(): number {
		let killed = 0;
		for (const [, e] of this.entries) {
			if (isProcessGroupAlive(e.pgid)) {
				killProcessTree(e.pgid);
				killed++;
			}
			e.status = "killed";
		}
		this.entries.clear();
		return killed;
	}
}

/** Глобальний singleton-реєстр процесів (один на сервер). */
export const processRegistry = new ProcessRegistry();
