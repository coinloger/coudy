/**
 * Сховище визначень кастомних провайдерів (models.json).
 * Pi розділяє: provider-def (models.json: baseUrl, api, models[]) vs credentials (auth.json: ключі).
 *
 * Формат ~/.coudycode/models.json:
 * { providers: { "<id>": { name?, baseUrl, apiKey?, api, headers?, authHeader?, models: [ModelDef] } } }
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

/** Тип API провайдера (сумісність). */
export type ApiType = "anthropic-messages" | "openai-completions" | "openai-responses";

/** Дефолти моделі (з pi parseModels). */
export interface ModelDef {
	id: string;
	name?: string;
	reasoning?: boolean;
	input?: ("text" | "image")[];
	cost?: { input: number; output: number; cacheRead: number; cacheWrite: number };
	contextWindow?: number;
	maxTokens?: number;
}

/** Визначення кастомного провайдера (з models.json). */
export interface ProviderDefinition {
	name?: string;
	baseUrl: string;
	apiKey?: string;
	api: ApiType;
	headers?: Record<string, string>;
	authHeader?: boolean;
	models: ModelDef[];
}

/** Каталог models.json. */
export interface ModelsConfig {
	providers: Record<string, ProviderDefinition>;
}

/** Базова директорія coudycode (env COUDYCODE_DIR || ~/.coudycode). */
function getCoudyDir(): string {
	const fromEnv = process.env["COUDYCODE_DIR"];
	if (fromEnv && fromEnv.trim().length > 0) return fromEnv;
	return join(homedir(), ".coudycode");
}

const WRITE_OPTIONS = { encoding: "utf-8", mode: 0o600 } as const;

/**
 * Сховище кастомних провайдерів (models.json, права 0o600).
 * Окремо від auth.json (пресети-ключі) — як у pi.
 */
export class ProviderDefinitions {
	private readonly path: string;

	constructor(path?: string) {
		this.path = path ?? join(getCoudyDir(), "models.json");
		this.ensureFile();
	}

	/** Шлях до models.json (діагностика). */
	get filePath(): string {
		return this.path;
	}

	private readAll(): ModelsConfig {
		try {
			if (!existsSync(this.path)) return { providers: {} };
			const raw = readFileSync(this.path, "utf-8").trim();
			if (!raw) return { providers: {} };
			const parsed = JSON.parse(raw) as ModelsConfig;
			return parsed && parsed.providers ? parsed : { providers: {} };
		} catch {
			return { providers: {} };
		}
	}

	private writeAll(data: ModelsConfig): void {
		this.ensureFile();
		writeFileSync(this.path, JSON.stringify(data, null, 2), WRITE_OPTIONS);
		try {
			chmodSync(this.path, 0o600);
		} catch {
			// деякі ФС — ігноруємо
		}
	}

	private ensureFile(): void {
		const dir = dirname(this.path);
		if (!existsSync(dir)) {
			mkdirSync(dir, { recursive: true, mode: 0o700 });
		}
		if (!existsSync(this.path)) {
			writeFileSync(this.path, JSON.stringify({ providers: {} }, null, 2), WRITE_OPTIONS);
			try {
				chmodSync(this.path, 0o600);
			} catch {
				// див. вище
			}
		}
	}

	/** Список id кастомних провайдерів. */
	list(): string[] {
		return Object.keys(this.readAll().providers);
	}

	/** Чи є кастомний провайдер. */
	has(id: string): boolean {
		return id in this.readAll().providers;
	}

	/** Отримати визначення провайдера (БЕЗ apiKey у відповідях для статусу — містить ключ!). */
	get(id: string): ProviderDefinition | undefined {
		return this.readAll().providers[id];
	}

	/** Публічне визначення (БЕЗ apiKey). */
	public getPublic(id: string): Omit<ProviderDefinition, "apiKey"> | undefined {
		const def = this.get(id);
		if (!def) return undefined;
		const { apiKey: _omit, ...rest } = def;
		return rest;
	}

	/** Зберегти/оновити визначення провайдера. */
	set(id: string, def: ProviderDefinition): void {
		const data = this.readAll();
		data.providers[id] = def;
		this.writeAll(data);
	}

	/** Видалити провайдер. */
	remove(id: string): boolean {
		const data = this.readAll();
		if (!(id in data.providers)) return false;
		delete data.providers[id];
		this.writeAll(data);
		return true;
	}
}
