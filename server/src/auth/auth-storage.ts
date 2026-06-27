/**
 * Зберігання облікових даних провайдерів (API-ключі).
 * Порт з pi auth-storage (Phase 1: лише api_key, БЕЗ OAuth).
 *
 * Файловий бекенд: ~/.coudycode/auth.json (права 0o600, батьківська директорія 0o700).
 * Пріоритет ключа: збережений api_key → env var (через @coudycode/ai getEnvApiKey).
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { findEnvKeys, getEnvApiKey } from "@coudycode/ai";

/** API-ключ провайдера (з опційними додатковими env-змінними). */
export type ApiKeyCredential = {
	type: "api_key";
	key: string;
	env?: Record<string, string>;
};

/** Облікові дані (Phase 1: лише api_key). */
export type AuthCredential = ApiKeyCredential;

/** Каталог provider-id → credential. */
export type AuthStorageData = Record<string, AuthCredential>;

/** Статус налаштування (БЕЗ секретів). */
export type AuthStatus = {
	configured: boolean;
	source?: "stored" | "environment";
	label?: string;
};

/** Базова директорія coudycode (env COUDYCODE_DIR || ~/.coudycode). */
function getCoudyDir(): string {
	const fromEnv = process.env["COUDYCODE_DIR"];
	if (fromEnv && fromEnv.trim().length > 0) return fromEnv;
	return join(homedir(), ".coudycode");
}

const AUTH_FILE_WRITE_OPTIONS = { encoding: "utf-8", mode: 0o600 } as const;

/**
 * Зберігання облікових даних: read-modify-write у JSON-файл.
 * Phase 1: без файлових локів (простий синхронний read/write).
 */
export class AuthStorage {
	private readonly authPath: string;

	constructor(authPath?: string) {
		this.authPath = authPath ?? join(getCoudyDir(), "auth.json");
		this.ensureFile();
	}

	/** Шлях до файлу auth.json (для логування/діагностики). */
	get path(): string {
		return this.authPath;
	}

	/** Увесь збережений каталог. */
	private readAll(): AuthStorageData {
		try {
			if (!existsSync(this.authPath)) return {};
			const raw = readFileSync(this.authPath, "utf-8").trim();
			if (!raw) return {};
			const parsed = JSON.parse(raw) as AuthStorageData;
			return parsed && typeof parsed === "object" ? parsed : {};
		} catch {
			return {};
		}
	}

	/** Записати повний каталог (атомарно за правами 0o600). */
	private writeAll(data: AuthStorageData): void {
		this.ensureFile();
		writeFileSync(this.authPath, JSON.stringify(data, null, 2), AUTH_FILE_WRITE_OPTIONS);
		try {
			chmodSync(this.authPath, 0o600);
		} catch {
			// chmod може не спрацювати на деяких ФС — ігноруємо.
		}
	}

	/** Створити батьківську директорію (0o700) та файл (0o600, "{}") за потреби. */
	private ensureFile(): void {
		const dir = dirname(this.authPath);
		if (!existsSync(dir)) {
			mkdirSync(dir, { recursive: true, mode: 0o700 });
		}
		if (!existsSync(this.authPath)) {
			writeFileSync(this.authPath, "{}", AUTH_FILE_WRITE_OPTIONS);
			try {
				chmodSync(this.authPath, 0o600);
			} catch {
				// див. вище
			}
		}
	}

	/** Отримати збережений credential провайдера. */
	get(provider: string): AuthCredential | undefined {
		return this.readAll()[provider];
	}

	/** Додаткові env-змінні збереженого api_key (якщо є). */
	getProviderEnv(provider: string): Record<string, string> | undefined {
		const cred = this.get(provider);
		if (cred?.type === "api_key" && cred.env) return { ...cred.env };
		return undefined;
	}

	/** Зберегти api_key провайдера. */
	set(provider: string, credential: AuthCredential): void {
		const data = this.readAll();
		data[provider] = credential;
		this.writeAll(data);
	}

	/** Видалити credential провайдера. */
	remove(provider: string): void {
		const data = this.readAll();
		if (provider in data) {
			delete data[provider];
			this.writeAll(data);
		}
	}

	/** Список сконфігурованих провайдерів (зі збереженого сховища). */
	list(): string[] {
		return Object.keys(this.readAll());
	}

	/** Чи є збережений credential. */
	has(provider: string): boolean {
		return provider in this.readAll();
	}

	/**
	 * Статус налаштування (БЕЗ секретів):
	 * stored → ключ у auth.json; environment → env var (label = імʼя змінної).
	 */
	getAuthStatus(provider: string): AuthStatus {
		if (this.has(provider)) {
			return { configured: true, source: "stored" };
		}
		const envKeys = findEnvKeys(provider);
		if (envKeys && envKeys.length > 0) {
			return { configured: true, source: "environment", label: envKeys[0] };
		}
		return { configured: false };
	}

	/** Отримати ключ для використання: пріоритет stored api_key → env var. */
	getApiKey(provider: string): string | undefined {
		const cred = this.get(provider);
		if (cred?.type === "api_key" && cred.key) return cred.key;
		return getEnvApiKey(provider);
	}
}
