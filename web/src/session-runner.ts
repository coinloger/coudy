/**
 * SessionRunner — позакомпонентний store активних чат-стрімів.
 * Переживає навігацію (НЕ в React-дереві): фоновий агент працює далі,
 * коли користувач переключився на інший чат/розділ.
 */
import type { AgentEvent } from "@coudycode/agent-core";
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
}

/** Подія subscribeAll (для toast-ів + sidebar-індикаторів). */
export type SessionRunnerEvent =
	| { type: "start"; sessionId: string }
	| { type: "update"; sessionId: string }
	| { type: "done"; sessionId: string }
	| { type: "error"; sessionId: string; message: string };

interface ActiveStream {
	controller: AbortController;
	working: ConversationState;
	running: boolean;
	error: string | null;
}

interface Listener {
	sessionId?: string; // undefined → global (subscribeAll)
	cb: (event: SessionRunnerEvent) => void;
}

class SessionRunner {
	private readonly streams = new Map<string, ActiveStream>();
	private readonly listeners = new Set<Listener>();

	/** Snapshot стану сесії (або idle-дефолт). */
	getSnapshot(sessionId: string): SessionStreamState {
		const s = this.streams.get(sessionId);
		if (!s) return { working: initialConversationState, running: false, error: null };
		return { working: s.working, running: s.running, error: s.error };
	}

	isRunning(sessionId: string): boolean {
		return this.streams.get(sessionId)?.running ?? false;
	}

	/** Список сесій, що зараз стрімляться (для sidebar). */
	runningIds(): string[] {
		const ids: string[] = [];
		for (const [id, s] of this.streams) if (s.running) ids.push(id);
		return ids;
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
	start(sessionId: string, message: string): void {
		if (!message.trim()) return;
		const existing = this.streams.get(sessionId);
		if (existing && existing.running) return; // guard дублів

		const controller = new AbortController();
		const stream: ActiveStream = {
			controller,
			working: { ...initialConversationState, working: true },
			running: true,
			error: null,
		};
		this.streams.set(sessionId, stream);
		this.emit({ type: "start", sessionId });

		streamChat({ sessionId, message, signal: controller.signal }, (event) => {
			this.handleEvent(sessionId, event);
		})
			.catch(() => {
				const s = this.streams.get(sessionId);
				if (s && s.running) {
					s.running = false;
					s.working = { ...s.working, working: false };
					this.emit({ type: "done", sessionId });
				}
			})
			.finally(() => {
				const s = this.streams.get(sessionId);
				if (s && s.running) {
					// Стрім завершився без явного agent_end (обрив) — фіналізуємо.
					s.running = false;
					s.working = { ...s.working, working: false };
					this.emit({ type: "done", sessionId });
				}
			});
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
		this.emit({ type: "done", sessionId });
	}

	private handleEvent(sessionId: string, event: AgentEvent): void {
		const s = this.streams.get(sessionId);
		if (!s) return;
		// error-подія від бекенду не частина AgentEvent-юніону — перевірити через окремий тип.
		if ((event as { type?: string }).type === "error") {
			const msg = (event as { message?: string }).message;
			if (typeof msg === "string") {
				s.error = msg;
				s.running = false;
				s.working = { ...s.working, working: false };
				this.emit({ type: "error", sessionId, message: msg });
			}
			return;
		}
		if (event.type === "agent_end") {
			s.working = applyEvent(s.working, event);
			s.running = false;
			this.emit({ type: "update", sessionId });
			this.emit({ type: "done", sessionId });
			return;
		}
		s.working = applyEvent(s.working, event);
		this.emit({ type: "update", sessionId });
	}

	/** Скинути локальний стан сесії (після рефрешу committed у ChatView). */
	clear(sessionId: string): void {
		this.streams.delete(sessionId);
	}
}

/** Глобальний singleton-раннер сесій. */
export const sessionRunner = new SessionRunner();
