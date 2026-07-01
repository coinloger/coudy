/**
 * SessionRunner — позакомпонентний store активних чат-стрімів.
 * Переживає навігацію (НЕ в React-дереві): фоновий агент працює далі,
 * коли користувач переключився на інший чат/розділ.
 */
import type { AgentEvent } from "@coudycode/agent-core";
import type { ImageContent } from "@coudycode/ai";
import {
	applyEvent,
	initialConversationState,
	type ConversationState,
} from "@coudycode/ui";
import { streamChat } from "./chat-stream";

/** Snapshot стріму сесії (для рендеру ChatView). */
export interface SessionStreamState {
	working: ConversationState;
	running: boolean;
	error: string | null;
	/** Мітка часу старту ходу (для elapsed-індикатора); undefined коли idle. */
	startTime?: number;
}

/** Стабільний idle-snapshot (те саме посилання, коли сесія не стрімиться). */
const IDLE_SNAPSHOT: SessionStreamState = {
	working: initialConversationState,
	running: false,
	error: null,
	startTime: undefined,
};

/** Подія subscribeAll (для toast-ів + sidebar-індикаторів). */
export type SessionRunnerEvent =
	| { type: "start"; sessionId: string }
	| { type: "update"; sessionId: string }
	| { type: "done"; sessionId: string }
	| { type: "error"; sessionId: string; message: string }
	| { type: "title"; sessionId: string; title: string };

interface ActiveStream {
	controller: AbortController;
	working: ConversationState;
	running: boolean;
	error: string | null;
	/** Мітка часу старту ходу (мс, Date.now()). */
	startTime: number;
	/** Кешований snapshot (стабільне посилання між змінами → useSyncExternalStore без циклу). */
	snapshot: SessionStreamState;
	/** Інтервал поллінгу статусу (attach-режим після refresh) — undefined для звичайного run. */
	pollTimer?: ReturnType<typeof setInterval>;
}

interface Listener {
	sessionId?: string; // undefined → global (subscribeAll)
	cb: (event: SessionRunnerEvent) => void;
}

class SessionRunner {
	private readonly streams = new Map<string, ActiveStream>();
	private readonly listeners = new Set<Listener>();
	// Стабільний кеш running-сесій (те саме посилання між змінами).
	private cachedRunningIds: string[] = [];

	/** Snapshot стану сесії (або стабільний idle-дефолт). */
	getSnapshot(sessionId: string): SessionStreamState {
		return this.streams.get(sessionId)?.snapshot ?? IDLE_SNAPSHOT;
	}

	isRunning(sessionId: string): boolean {
		return this.streams.get(sessionId)?.running ?? false;
	}

	/** Список сесій, що зараз стрімляться (для sidebar) — стабільна посилання. */
	runningIds(): string[] {
		return this.cachedRunningIds;
	}

	/** Перебудувати кеш running-сесій (лише при зміні множини running). */
	private rebuildRunning(): void {
		const ids: string[] = [];
		for (const [id, s] of this.streams) if (s.running) ids.push(id);
		this.cachedRunningIds = ids;
	}

	/** Перебудувати snapshot стріму (стабільне посилання між змінами). */
	private rebuildSnapshot(s: ActiveStream): void {
		s.snapshot = {
			working: s.working,
			running: s.running,
			error: s.error,
			startTime: s.running ? s.startTime : undefined,
		};
	}

	/** Підписатись на події однієї сесії. */
	subscribe(sessionId: string, cb: (event: SessionRunnerEvent) => void): () => void {
		const l: Listener = { sessionId, cb };
		this.listeners.add(l);
		return () => {
			this.listeners.delete(l);
		};
	}

	/** Підписатись на ВСІ події (для toast-ів). */
	subscribeAll(cb: (event: SessionRunnerEvent) => void): () => void {
		const l: Listener = { cb };
		this.listeners.add(l);
		return () => {
			this.listeners.delete(l);
		};
	}

	private emit(event: SessionRunnerEvent): void {
		for (const l of this.listeners) {
			if (l.sessionId === undefined || l.sessionId === event.sessionId) {
				l.cb(event);
			}
		}
	}

	/**
	 * Запустити чат-стрім. Один активний стрім на сесію (guard дублів).
	 * НЕ прибираємо з Map одразу після done — даємо підписникам зчитати фінал,
	 * потім залишаємо з running=false до наступного start.
	 */
	start(sessionId: string, message: string, images?: ImageContent[]): void {
		if (!message.trim() && !(images && images.length)) return;
		const existing = this.streams.get(sessionId);
		if (existing && existing.running) return; // guard дублів

		const controller = new AbortController();
		const stream: ActiveStream = {
			controller,
			working: { ...initialConversationState, working: true },
			running: true,
			error: null,
			startTime: Date.now(),
			snapshot: { working: initialConversationState, running: false, error: null },
		};
		this.rebuildSnapshot(stream);
		this.rebuildRunning();
		this.streams.set(sessionId, stream);
		this.emit({ type: "start", sessionId });

		streamChat({ sessionId, message, signal: controller.signal, images }, (event) => {
			this.handleEvent(sessionId, event);
		})
			.catch(() => {
				const s = this.streams.get(sessionId);
				if (s && s.running) {
					s.running = false;
					s.working = { ...s.working, working: false };
					this.rebuildSnapshot(s);
					this.rebuildRunning();
					this.emit({ type: "done", sessionId });
				}
			})
			.finally(() => {
				const s = this.streams.get(sessionId);
				if (s && s.running) {
					// Стрім завершився без явного agent_end (обрив) — фіналізуємо.
					s.running = false;
					s.working = { ...s.working, working: false };
					this.rebuildSnapshot(s);
					this.rebuildRunning();
					this.emit({ type: "done", sessionId });
				}
			});
	}

	/**
	 * Attach до сесії, що вже виконується на бекенді (напр. після refresh під час
	 * генерації). НЕ POST /api/chat — лише синтетичний running snapshot + поллінг
	 * GET /api/sessions/:id/status. Поки running=true — WorkIndicator visible, компзер
	 * disabled. По завершенню (running=false) — done-подія → ChatView loadSession
	 * підтягує персистовані повідомлення (вкл. фінальну відповідь).
	 */
	attach(sessionId: string, startedAt?: number): void {
		if (this.streams.has(sessionId)) return; // вже підписані (звичайний run або повторний attach)
		const stream: ActiveStream = {
			controller: new AbortController(),
			working: { ...initialConversationState, working: true },
			running: true,
			error: null,
			startTime: startedAt ?? Date.now(),
			snapshot: { working: initialConversationState, running: false, error: null },
		};
		this.rebuildSnapshot(stream);
		this.rebuildRunning();
		this.streams.set(sessionId, stream);
		this.emit({ type: "start", sessionId });

		// Поллінг статусу кожні 1.5с.
		const poll = async (): Promise<void> => {
			try {
				const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/status`);
				if (!res.ok) return;
				const data = (await res.json()) as { running?: boolean };
				if (!data.running) {
					const s = this.streams.get(sessionId);
					if (s && s.running) {
						if (s.pollTimer) clearInterval(s.pollTimer);
						s.pollTimer = undefined;
						s.running = false;
						s.working = { ...s.working, working: false };
						this.rebuildSnapshot(s);
						this.rebuildRunning();
						this.emit({ type: "update", sessionId });
						this.emit({ type: "done", sessionId });
					}
				}
			} catch {
				/* ігноруємо мережеві помилки поллінгу */
			}
		};
		stream.pollTimer = setInterval(() => { void poll(); }, 1500);
	}

	/** Явний стоп: POST /abort (сервер абортить harness) + controller.abort. */
	async abort(sessionId: string): Promise<void> {
		const s = this.streams.get(sessionId);
		if (!s || !s.running) return;
		try {
			await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/abort`, { method: "POST" });
		} catch {
			/* ignore */
		}
		s.controller.abort();
		s.running = false;
		s.working = { ...s.working, working: false };
		this.rebuildSnapshot(s);
		this.rebuildRunning();
		this.emit({ type: "done", sessionId });
	}

	private handleEvent(sessionId: string, event: AgentEvent): void {
		const s = this.streams.get(sessionId);
		if (!s) return;
		// session:title — авто-назва чату від бекенду (не частина AgentEvent-юніону).
		if ((event as { type?: string }).type === "session:title") {
			const title = (event as { title?: string }).title;
			if (typeof title === "string") {
				this.emit({ type: "title", sessionId, title });
			}
			return;
		}
		// error-подія від бекенду не частина AgentEvent-юніону — перевірити через окремий тип.
		if ((event as { type?: string }).type === "error") {
			const msg = (event as { message?: string }).message;
			if (typeof msg === "string") {
				s.error = msg;
				s.running = false;
				s.working = { ...s.working, working: false };
				this.rebuildSnapshot(s);
				this.rebuildRunning();
				this.emit({ type: "error", sessionId, message: msg });
			}
			return;
		}
		if (event.type === "agent_end") {
			s.working = applyEvent(s.working, event);
			s.running = false;
			this.rebuildSnapshot(s);
			this.rebuildRunning();
			this.emit({ type: "update", sessionId });
			this.emit({ type: "done", sessionId });
			return;
		}
		s.working = applyEvent(s.working, event);
		this.rebuildSnapshot(s);
		this.emit({ type: "update", sessionId });
	}

	/** Скинути локальний стан сесії (після рефрешу committed у ChatView). */
	clear(sessionId: string): void {
		const s = this.streams.get(sessionId);
		if (s?.pollTimer) clearInterval(s.pollTimer);
		this.streams.delete(sessionId);
		this.rebuildRunning();
	}
}

/** Глобальний singleton-раннер сесій. */
export const sessionRunner = new SessionRunner();
