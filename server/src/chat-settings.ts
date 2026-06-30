/**
 * Налаштування чату: persisted JSON-сховище (0o600, ~/.coudycode/chat-settings.json).
 * Зараз містить параметри авто-компакту; структура розширювана для майбутніх налаштувань.
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

/** Налаштування чату. */
export interface ChatSettings {
	/** Авто-стиснення контексту при досягненні порогу. */
	autoCompact: boolean;
	/** Поріг авто-компакту у відсотках contextWindow (50-95). */
	compactThresholdPct: number;
}

/** Дефолтні налаштування чату. */
export const DEFAULT_CHAT_SETTINGS: ChatSettings = {
	autoCompact: true,
	compactThresholdPct: 80,
};

/** Межі порогу авто-компакту у відсотках. */
export const COMPACT_THRESHOLD_MIN = 50;
export const COMPACT_THRESHOLD_MAX = 95;

/** Базова директорія coudycode (env COUDYCODE_DIR || ~/.coudycode). */
function getCoudyDir(): string {
	const fromEnv = process.env["COUDYCODE_DIR"];
	if (fromEnv && fromEnv.trim().length > 0) return fromEnv;
	return join(homedir(), ".coudycode");
}

const WRITE_OPTIONS = { encoding: "utf-8", mode: 0o600 } as const;

/** Створити батьківську директорію (0o700) + файл (0o600) за потреби. */
function ensureFile(filePath: string, initialContent: string): void {
	const dir = dirname(filePath);
	if (!existsSync(dir)) {
		mkdirSync(dir, { recursive: true, mode: 0o700 });
	}
	if (!existsSync(filePath)) {
		writeFileSync(filePath, initialContent, WRITE_OPTIONS);
		try {
			chmodSync(filePath, 0o600);
		} catch {
			/* chmod може не спрацювати на деяких ФС — ігноруємо */
		}
	}
}

/** Проста JSON persistence (read-modify-write). */
function readJson<T>(filePath: string, fallback: T): T {
	try {
		if (!existsSync(filePath)) return fallback;
		const raw = readFileSync(filePath, "utf-8").trim();
		if (!raw) return fallback;
		const parsed = JSON.parse(raw) as T;
		return parsed && typeof parsed === "object" ? parsed : fallback;
	} catch {
		return fallback;
	}
}

function writeJson(filePath: string, data: unknown): void {
	ensureFile(filePath, "{}");
	writeFileSync(filePath, JSON.stringify(data, null, 2), WRITE_OPTIONS);
	try {
		chmodSync(filePath, 0o600);
	} catch {
		/* див. вище */
	}
}

/** Перевірити валідність значення compactThresholdPct. */
function isValidThreshold(v: unknown): v is number {
	return typeof v === "number" && Number.isFinite(v) && v >= COMPACT_THRESHOLD_MIN && v <= COMPACT_THRESHOLD_MAX;
}

/**
 * Сховище налаштувань чату (~/.coudycode/chat-settings.json, 0o600).
 * get() повертає злиття дефолтів із файлом; update() валідує патч.
 */
export class ChatSettingsStore {
	private readonly path: string;

	constructor(path?: string) {
		this.path = path ?? join(getCoudyDir(), "chat-settings.json");
		ensureFile(this.path, JSON.stringify(DEFAULT_CHAT_SETTINGS));
	}

	/** Поточні налаштування (дефолти ← перекриті значеннями з файлу). */
	get(): ChatSettings {
		const raw = readJson<Partial<ChatSettings>>(this.path, {});
		return {
			autoCompact: typeof raw.autoCompact === "boolean" ? raw.autoCompact : DEFAULT_CHAT_SETTINGS.autoCompact,
			compactThresholdPct: isValidThreshold(raw.compactThresholdPct)
				? raw.compactThresholdPct
				: DEFAULT_CHAT_SETTINGS.compactThresholdPct,
		};
	}

	/**
	 * Застосувати патч до налаштувань (лише валідні поля).
	 * Повертає оновлені налаштування. Кидає Error при невалідному compactThresholdPct.
	 */
	update(patch: Partial<ChatSettings>): ChatSettings {
		const current = this.get();
		if ("autoCompact" in patch && typeof patch.autoCompact !== "boolean") {
			throw new Error("autoCompact має бути boolean");
		}
		if ("compactThresholdPct" in patch && !isValidThreshold(patch.compactThresholdPct)) {
			throw new Error(`compactThresholdPct має бути числом у межах ${COMPACT_THRESHOLD_MIN}-${COMPACT_THRESHOLD_MAX}`);
		}
		const next: ChatSettings = {
			autoCompact: patch.autoCompact ?? current.autoCompact,
			compactThresholdPct: patch.compactThresholdPct ?? current.compactThresholdPct,
		};
		writeJson(this.path, next);
		return next;
	}
}
