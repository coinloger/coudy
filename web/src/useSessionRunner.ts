import { useSyncExternalStore } from "react";
import { sessionRunner, type SessionStreamState } from "./session-runner";

/** Порожній snapshot (стабільне посилання для useSyncExternalStore). */
const IDLE: SessionStreamState = { working: { messages: [], toolStatus: {}, working: false }, running: false, error: null };

/**
 * useSessionRunner(sessionId) — підписка на стан фонового стріму сесії.
 * Повертає { working, running, error, start, abort }. Переживає навігацію:
 * при заході в чат з активним стрімом підписується на існуючий state в Map.
 */
export function useSessionRunner(sessionId: string): {
	working: SessionStreamState["working"];
	running: boolean;
	error: string | null;
	start: (message: string, images?: import("@coudycode/ai").ImageContent[]) => void;
	abort: () => void;
} {
	const subscribe = (cb: () => void): (() => void) => sessionRunner.subscribe(sessionId, cb);

	const getSnapshot = (): SessionStreamState => {
		const s = sessionRunner.getSnapshot(sessionId);
		// useSyncExternalStore потребує стабільного посилання при незмінному стані.
		// Для idle повертаємо сталу константу, щоб уникнути зайвих ререндерів.
		if (!s.running && s.working.messages.length === 0 && !s.working.working && !s.error) {
			return IDLE;
		}
		return s;
	};

	const snap = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

	return {
		working: snap.working,
		running: snap.running,
		error: snap.error,
		start: (message: string, images?: import("@coudycode/ai").ImageContent[]): void =>
			sessionRunner.start(sessionId, message, images),
		abort: (): void => {
			void sessionRunner.abort(sessionId);
		},
	};
}
