/**
 * Plugin-owned ізольовані сесії: декларативна привʼязка з СТРУКТУРНОЮ ізоляцією.
 *
 * Дві частини:
 *
 * 1. PluginSessionRegistryImpl (in-memory): pluginName → PluginSessionConfig[].
 *    Плагін декларує сесію через ctx.declareSession(config). Конфіг живе ТІЛЬКИ тут
 *    і застосовується лише у власній сесії — ніколи не реєструється в глобальному
 *    HookEngine (забруднення неможливе структурно).
 *
 * 2. PluginSessionStore (persisted ~/.coudycode/plugin-sessions.json, 0o600):
 *    мапить "pluginName:pluginSessionId" → realSessionUuid (agent-core).
 *    Двосторонній lookup: за pluginKey (declare/create) та за realSessionUuid
 *    (визначення власності під час /api/chat).
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import type { PluginSessionConfig, PluginSessionOwnership, PluginSessionRegistry } from "@coudycode/core";

/** Базова директорія coudycode (env COUDYCODE_DIR || ~/.coudycode). */
function getCoudyDir(): string {
	const fromEnv = process.env["COUDYCODE_DIR"];
	if (fromEnv && fromEnv.trim().length > 0) return fromEnv;
	return join(homedir(), ".coudycode");
}

const WRITE_OPTIONS = { encoding: "utf-8", mode: 0o600 } as const;

/** Формат persisted-файлу. */
interface PluginSessionStoreFile {
	/** Ключ "pluginName:pluginSessionId" → realSessionUuid. */
	mappings: Record<string, string>;
}

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

/** Ключ persisted-маппінгу. */
function pluginKey(pluginName: string, pluginSessionId: string): string {
	return `${pluginName}:${pluginSessionId}`;
}

/**
 * Резидентний реєстр декларованих сесій плагінів.
 * (Конфіг НЕ персиститься — він ре-декларується при кожному activate плагіна.)
 */
export class PluginSessionRegistryImpl implements PluginSessionRegistry {
	private byPlugin = new Map<string, Map<string, PluginSessionConfig>>();

	declare(pluginName: string, config: PluginSessionConfig): void {
		let pluginMap = this.byPlugin.get(pluginName);
		if (!pluginMap) {
			pluginMap = new Map();
			this.byPlugin.set(pluginName, pluginMap);
		}
		pluginMap.set(config.id, config);
		console.log(`[plugin-sessions] declare: ${pluginName}:${config.id}`);
	}

	removeAll(pluginName: string): void {
		this.byPlugin.delete(pluginName);
	}

	get(pluginName: string, pluginSessionId: string): PluginSessionConfig | undefined {
		return this.byPlugin.get(pluginName)?.get(pluginSessionId);
	}

	entries(): Array<{ pluginName: string; config: PluginSessionConfig }> {
		const out: Array<{ pluginName: string; config: PluginSessionConfig }> = [];
		for (const [pluginName, pluginMap] of this.byPlugin) {
			for (const config of pluginMap.values()) {
				out.push({ pluginName, config });
			}
		}
		return out;
	}
}

/**
 * Persisted-стore: "pluginName:pluginSessionId" → realSessionUuid.
 * Двосторонній lookup для структурної ізоляції.
 */
export class PluginSessionStore {
	private readonly path: string;

	constructor(path?: string) {
		this.path = path ?? join(getCoudyDir(), "plugin-sessions.json");
		ensureFile(this.path, JSON.stringify({ mappings: {} }));
	}

	private readAll(): PluginSessionStoreFile {
		return readJson<PluginSessionStoreFile>(this.path, { mappings: {} });
	}

	private writeAll(data: PluginSessionStoreFile): void {
		writeJson(this.path, data);
	}

	/** realSessionUuid за pluginKey (або undefined). */
	getByPluginKey(pluginName: string, pluginSessionId: string): string | undefined {
		return this.readAll().mappings[pluginKey(pluginName, pluginSessionId)];
	}

	/** Запамʼятати/оновити привʼязку pluginKey → realSessionUuid. */
	set(pluginName: string, pluginSessionId: string, realSessionUuid: string): void {
		const data = this.readAll();
		data.mappings[pluginKey(pluginName, pluginSessionId)] = realSessionUuid;
		this.writeAll(data);
	}

	/** Власність сесії за realSessionUuid (або null = глобальна сесія). */
	findBySessionId(realSessionUuid: string): { pluginName: string; pluginSessionId: string } | null {
		const mappings = this.readAll().mappings;
		for (const [key, uuid] of Object.entries(mappings)) {
			if (uuid === realSessionUuid) {
				const sep = key.indexOf(":");
				return {
					pluginName: sep === -1 ? key : key.slice(0, sep),
					pluginSessionId: sep === -1 ? "" : key.slice(sep + 1),
				};
			}
		}
		return null;
	}

	/** Усі маппінги (для /api/sessions визначення власності). */
	allMappings(): Record<string, string> {
		return this.readAll().mappings;
	}

	/** Прибрати всі привʼязки плагіна (при видаленні плагіна). */
	removeByPlugin(pluginName: string): void {
		const data = this.readAll();
		const prefix = `${pluginName}:`;
		let changed = false;
		for (const key of Object.keys(data.mappings)) {
			if (key.startsWith(prefix)) {
				delete data.mappings[key];
				changed = true;
			}
		}
		if (changed) this.writeAll(data);
	}
}

/**
 * Резолвити ownership plugin-сесії за realSessionUuid: знайти persisted-привʼязку,
 * потім конфіг у резидентному реєстрі. Якщо конфігу нема (плагін вимкнено) → null.
 */
export function resolvePluginOwnership(
	realSessionUuid: string,
	registry: PluginSessionRegistryImpl,
	store: PluginSessionStore,
): PluginSessionOwnership | null {
	const ownership = store.findBySessionId(realSessionUuid);
	if (!ownership) return null;
	const config = registry.get(ownership.pluginName, ownership.pluginSessionId);
	if (!config) return null;
	return {
		pluginName: ownership.pluginName,
		pluginSessionId: ownership.pluginSessionId,
		config,
	};
}
