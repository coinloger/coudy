/**
 * In-memory сховище pending OAuth-сесій.
 *
 * OAuth-флоу асинхронний (callback-сервер / device-code polling) → стартуємо login
 * у фоні, одразу віддаємо URL/deviceCode фронту, а він поллить статус.
 */
import type { OAuthLoginCallbacks } from "@coudycode/ai";

export interface PendingSession {
	status: "pending" | "done" | "error";
	/** Тип флоу: callback (відкрити URL) або device (ввести код). */
	type?: "callback" | "device";
	url?: string;
	userCode?: string;
	verificationUri?: string;
	error?: string;
	/** AbortController для скасування login. */
	controller?: AbortController;
	/** Таймер автоочистки. */
	timeout?: ReturnType<typeof setTimeout>;
}

const SESSION_TTL_MS = 10 * 60 * 1000; // 10 хв

const sessions = new Map<string, PendingSession>();

/** Дочекатись, поки сесія буде «озброєна» (type встановлено) або timeout. */
export async function waitForArmed(providerId: string, timeoutMs = 2000): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const s = sessions.get(providerId);
		if (s && s.type) return;
		if (s && (s.status === "done" || s.status === "error")) return;
		await new Promise((r) => setTimeout(r, 50));
	}
}

/** Створити/перезапустити сесію. */
export function createSession(providerId: string): PendingSession {
	clearSession(providerId);
	const controller = new AbortController();
	const session: PendingSession = { status: "pending", controller };
	sessions.set(providerId, session);
	scheduleCleanup(providerId);
	return session;
}

/** Отримати сесію (для poll). */
export function getSession(providerId: string): PendingSession | undefined {
	return sessions.get(providerId);
}

/** Статус для клієнта (БЕЗ службових полів). */
export function sessionStatus(providerId: string): {
	status: string;
	type?: string;
	url?: string;
	userCode?: string;
	verificationUri?: string;
	error?: string;
} | undefined {
	const s = sessions.get(providerId);
	if (!s) return undefined;
	const { controller: _c, timeout: _t, ...rest } = s;
	return rest;
}

/** Позначити завершеною (кред збережено). */
export function markDone(providerId: string): void {
	const s = sessions.get(providerId);
	if (s) {
		s.status = "done";
		scheduleCleanup(providerId);
	}
}

/** Позначити помилкою. */
export function markError(providerId: string, error: string): void {
	const s = sessions.get(providerId);
	if (s) {
		s.status = "error";
		s.error = error;
		scheduleCleanup(providerId);
	}
}

/** Скасувати (abort) та очистити. */
export function cancelSession(providerId: string): void {
	const s = sessions.get(providerId);
	if (s?.controller) {
		try {
			s.controller.abort();
		} catch {
			// ігноруємо
		}
	}
	clearSession(providerId);
}

/** Очистити сесію. */
function clearSession(providerId: string): void {
	const s = sessions.get(providerId);
	if (s?.timeout) clearTimeout(s.timeout);
	sessions.delete(providerId);
}

/** Запланувати автоочистку через SESSION_TTL_MS. */
function scheduleCleanup(providerId: string): void {
	const s = sessions.get(providerId);
	if (!s) return;
	if (s.timeout) clearTimeout(s.timeout);
	s.timeout = setTimeout(() => {
		cancelSession(providerId);
	}, SESSION_TTL_MS);
}

/**
 * Побудувати OAuthLoginCallbacks, що заповнюють pending-сесію.
 * onPrompt/onSelect/onManualCodeInput — заглушки (фоновий логін без TTY).
 */
export function buildSessionCallbacks(providerId: string): OAuthLoginCallbacks {
	const session = getSession(providerId);
	const controller = session?.controller;
	return {
		onAuth: (info) => {
			const s = getSession(providerId);
			if (s) {
				s.type = "callback";
				s.url = info.url;
			}
		},
		onDeviceCode: (info) => {
			const s = getSession(providerId);
			if (s) {
				s.type = "device";
				s.userCode = info.userCode;
				s.verificationUri = info.verificationUri;
			}
		},
		onPrompt: () => Promise.resolve(""),
		onSelect: () => Promise.resolve("device_code"),
		onManualCodeInput: undefined,
		...(controller ? { signal: controller.signal } : {}),
	};
}
