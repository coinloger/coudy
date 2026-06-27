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
import type { OAuthCredentials, OAuthLoginCallbacks, OAuthProviderId } from "@coudycode/ai";
import { getOAuthApiKey, getOAuthProvider, getOAuthProviders } from "@coudycode/ai/oauth";

/** API-ключ провайдера (з опційними додатковими env-змінними). */
export type ApiKeyCredential = {
	type: "api_key";
	key: string;
	env?: Record<string, string>;
};

/** OAuth-креденшал (підписка): access/refresh токени + термін. */
export type OAuthCredential = {
	type: "oauth";
} & OAuthCredentials;

/** Облікові дані (api_key АБО oauth). */
export type AuthCredential = ApiKeyCredential | OAuthCredential;

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

	/**
	 * Отримати ключ для використання (async — OAuth потребує refresh):
	 * пріоритет stored (api_key/oauth → з авто-refresh) → env var.
	 */
	async getApiKey(provider: string): Promise<string | undefined> {
		const cred = this.get(provider);
		if (cred?.type === "api_key" && cred.key) return cred.key;
		if (cred?.type === "oauth") {
			// getOAuthApiKey сам перевірить expires та оновить токен через refreshToken.
			try {
				const oauthCreds: Record<string, OAuthCredentials> = { [provider]: cred };
				const result = await getOAuthApiKey(provider as OAuthProviderId, oauthCreds);
				if (result) {
					// Зберегти оновлений токен (нові expires/access/refresh).
					this.set(provider, { type: "oauth", ...result.newCredentials });
					return result.apiKey;
				}
			} catch {
				return undefined;
			}
			return undefined;
		}
		return getEnvApiKey(provider);
	}

	/** Список OAuth-провайдерів з @coudycode/ai. */
	getOAuthProviders() {
		return getOAuthProviders();
	}

	/** Чи підтримує провайдер OAuth-логін. */
	isOAuthProvider(provider: string): boolean {
		return !!getOAuthProvider(provider as OAuthProviderId);
	}

	/**
	 * OAuth-логін через провайдер з @coudycode/ai.
	 * callbacks передаються у провайдер (onAuth/onDeviceCode/...); після успіху
	 * зберігає {type:"oauth", refresh, access, expires}.
	 */
	async login(provider: string, callbacks: OAuthLoginCallbacks): Promise<void> {
		const oauthProvider = getOAuthProvider(provider as OAuthProviderId);
		if (!oauthProvider) {
			throw new Error(`Невідомий OAuth-провайдер: ${provider}`);
		}
		const credentials = await oauthProvider.login(callbacks);
		this.set(provider, { type: "oauth", ...credentials });
	}
}
