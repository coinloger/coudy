/**
 * Проєкти (контейнер сесій) + per-проєкт памʼять (міні-вказівки).
 *
 * Дві persisted-частини:
 *
 * 1. ProjectStore (~/.coudycode/projects.json, 0o600):
 *    реєстр проєктів {projects:[{id,name,createdAt}]}.
 *    Памʼять проєкту: ~/.coudycode/projects/<id>/memory.json {items:[{id,text,createdAt}]}.
 *
 * 2. ProjectMembershipStore (~/.coudycode/project-members.json, 0o600):
 *    sidecar-мапа sessionId → projectId (як у плагін-сесій — НЕ лізе в agent-core
 *    JSONL-repo). Двосторонній lookup: за session + за project.
 *
 * deleteProject: проєкт зникає, його сесії стають «loose» (розпуюються з проєкту,
 * лишаються). Memory-файл видаляється разом з папкою проєкту.
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";
import { Type, type Static } from "typebox";
import { wrapToolDefinition } from "@coudycode/tools";
import type { ToolDefinition } from "@coudycode/tools";
import type { AgentTool } from "@coudycode/agent-core";

/** Базова директорія coudycode (env COUDYCODE_DIR || ~/.coudycode). */
function getCoudyDir(): string {
	const fromEnv = process.env["COUDYCODE_DIR"];
	if (fromEnv && fromEnv.trim().length > 0) return fromEnv;
	return join(homedir(), ".coudycode");
}

const WRITE_OPTIONS = { encoding: "utf-8", mode: 0o600 } as const;

export interface Project {
	id: string;
	name: string;
	createdAt: string;
}

export interface MemoryItem {
	id: string;
	text: string;
	createdAt: string;
}

/** Формат persisted-реєстру проєктів. */
interface ProjectsFile {
	projects: Project[];
}

/** Формат persisted-памʼяті проєкту. */
interface MemoryFile {
	items: MemoryItem[];
}

/** Формат persisted-мапи сесія→проєкт. */
interface MembershipFile {
	/** sessionId → projectId. */
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

function ensureDir(dirPath: string): void {
	if (!existsSync(dirPath)) {
		mkdirSync(dirPath, { recursive: true, mode: 0o700 });
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

/**
 * Реєстр проєктів + памʼять кожного (~/.coudycode/projects.json + projects/<id>/memory.json).
 */
export class ProjectStore {
	private readonly registryPath: string;
	private readonly projectsDir: string;

	constructor(baseDir?: string) {
		const base = baseDir ?? getCoudyDir();
		this.registryPath = join(base, "projects.json");
		this.projectsDir = join(base, "projects");
		ensureFile(this.registryPath, JSON.stringify({ projects: [] }));
		ensureDir(this.projectsDir);
	}

	private readRegistry(): ProjectsFile {
		return readJson<ProjectsFile>(this.registryPath, { projects: [] });
	}

	private writeRegistry(data: ProjectsFile): void {
		writeJson(this.registryPath, data);
	}

	private memoryPath(projectId: string): string {
		return join(this.projectsDir, projectId, "memory.json");
	}

	private readMemory(projectId: string): MemoryFile {
		const path = this.memoryPath(projectId);
		if (!existsSync(path)) return { items: [] };
		return readJson<MemoryFile>(path, { items: [] });
	}

	private writeMemory(projectId: string, data: MemoryFile): void {
		const path = this.memoryPath(projectId);
		ensureDir(dirname(path));
		writeJson(path, data);
	}

	/** Створити новий проєкт. */
	create(name: string): Project {
		const trimmed = name.trim();
		const project: Project = {
			id: randomUUID(),
			name: trimmed || "Без назви",
			createdAt: new Date().toISOString(),
		};
		const data = this.readRegistry();
		data.projects.push(project);
		this.writeRegistry(data);
		// Ініціалізувати порожню памʼять.
		this.writeMemory(project.id, { items: [] });
		return project;
	}

	/** Список усіх проєктів. */
	list(): Project[] {
		return this.readRegistry().projects;
	}

	/** Проєкт за id (або null). */
	get(id: string): Project | null {
		return this.readRegistry().projects.find((p) => p.id === id) ?? null;
	}

	/** Перейменувати проєкт. */
	rename(id: string, name: string): Project | null {
		const trimmed = name.trim();
		if (!trimmed) return null;
		const data = this.readRegistry();
		const project = data.projects.find((p) => p.id === id);
		if (!project) return null;
		project.name = trimmed;
		this.writeRegistry(data);
		return project;
	}

	/**
	 * Видалити проєкт (разом з папкою memory). Сесії стають «loose» — але це
	 * робить MembershipStore.removeProject (розпуювання), бо він знає список сесій.
	 */
	delete(id: string): boolean {
		const data = this.readRegistry();
		const idx = data.projects.findIndex((p) => p.id === id);
		if (idx === -1) return false;
		data.projects.splice(idx, 1);
		this.writeRegistry(data);
		// Прибрати папку памʼяті проєкту (memory.json).
		const memDir = join(this.projectsDir, id);
		if (existsSync(memDir)) {
			try {
				rmSync(memDir, { recursive: true, force: true });
			} catch {
				/* необовʼязково */
			}
		}
		return true;
	}

	/** Памʼять проєкту (список items). */
	getMemory(projectId: string): MemoryItem[] {
		if (!this.get(projectId)) return [];
		return this.readMemory(projectId).items;
	}

	/** Додати правило в памʼять проєкту. Повертає створений item. */
	saveMemory(projectId: string, text: string): MemoryItem | null {
		if (!this.get(projectId)) return null;
		const item: MemoryItem = {
			id: randomUUID(),
			text: text.trim(),
			createdAt: new Date().toISOString(),
		};
		const data = this.readMemory(projectId);
		data.items.push(item);
		this.writeMemory(projectId, data);
		return item;
	}

	/** Видалити правило з памʼяті. */
	deleteMemory(projectId: string, itemId: string): boolean {
		if (!this.get(projectId)) return false;
		const data = this.readMemory(projectId);
		const idx = data.items.findIndex((i) => i.id === itemId);
		if (idx === -1) return false;
		data.items.splice(idx, 1);
		this.writeMemory(projectId, data);
		return true;
	}
}

/**
 * Sidecar-мапа сесія↔проєкт (~/.coudycode/project-members.json, 0o600).
 * НЕ лізе в agent-core JSONL-repo (як у плагін-сесій).
 */
export class ProjectMembershipStore {
	private readonly path: string;

	constructor(baseDir?: string) {
		const base = baseDir ?? getCoudyDir();
		this.path = join(base, "project-members.json");
		ensureFile(this.path, JSON.stringify({ mappings: {} }));
	}

	private readAll(): MembershipFile {
		return readJson<MembershipFile>(this.path, { mappings: {} });
	}

	private writeAll(data: MembershipFile): void {
		writeJson(this.path, data);
	}

	/** projectId для session (або null = loose-чат). */
	getProjectId(sessionId: string): string | null {
		return this.readAll().mappings[sessionId] ?? null;
	}

	/** Привʼязати сесію до проєкту (перепривʼязка можлива — інший projectId). */
	assign(sessionId: string, projectId: string): void {
		const data = this.readAll();
		data.mappings[sessionId] = projectId;
		this.writeAll(data);
	}

	/** Розпуювати сесію з проєкту (→ loose). */
	unassign(sessionId: string): void {
		const data = this.readAll();
		if (sessionId in data.mappings) {
			delete data.mappings[sessionId];
			this.writeAll(data);
		}
	}

	/** Усі sessionId проєкту. */
	getSessionsForProject(projectId: string): string[] {
		const mappings = this.readAll().mappings;
		return Object.entries(mappings)
			.filter(([, pid]) => pid === projectId)
			.map(([sid]) => sid);
	}

	/** Усі сесії проєкту стають loose (при deleteProject). */
	removeProject(projectId: string): void {
		const data = this.readAll();
		let changed = false;
		for (const [sid, pid] of Object.entries(data.mappings)) {
			if (pid === projectId) {
				delete data.mappings[sid];
				changed = true;
			}
		}
		if (changed) this.writeAll(data);
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// Memory-тулзи (лише в сесіях проєкту; замикання над projectId + store).
// ─────────────────────────────────────────────────────────────────────────────

const memorySaveSchema = Type.Object({
	text: Type.String({ description: "Правило/вказівка проєкту для запамʼятовування (українською, коротко, імператив)." }),
});

const memoryDeleteSchema = Type.Object({
	id: Type.Optional(Type.String({ description: "id правила для видалення (з результату memory_save або памʼяті)." })),
});

/**
 * Створити memory-тулзи для сесії проєкту (замикання над projectId + store),
 * як skill-library робить з sessionId.
 */
export function createMemoryTools(projectId: string, store: ProjectStore): AgentTool[] {
	const saveDef: ToolDefinition<typeof memorySaveSchema> = {
		name: "memory_save",
		label: "memory_save",
		group: "Памʼять",
		description:
			"Зберегти правило/вказівку в памʼять проєкту (міні-інструкції, що інжектяться в system-prompt наступних ходів). " +
			"Викликай, коли користувач каже «запамʼятай/remember/запамʼятуй X» або коли треба закріпити усталену вимогу проєкту.",
		promptSnippet: "Зберегти правило проєкту в памʼять",
		parameters: memorySaveSchema,
		async execute(_id, params: Static<typeof memorySaveSchema>) {
			const text = params.text?.trim();
			if (!text) {
				return { content: [{ type: "text", text: "Текст правила порожній — нічого не збережено." }], details: undefined };
			}
			const item = store.saveMemory(projectId, text);
			if (!item) {
				return { content: [{ type: "text", text: "Проєкт не знайдено — правило не збережено." }], details: undefined };
			}
			return {
				content: [{ type: "text", text: `Збережено правило проєкту (id=${item.id}): ${item.text}` }],
				details: undefined,
			};
		},
	};

	const deleteDef: ToolDefinition<typeof memoryDeleteSchema> = {
		name: "memory_delete",
		label: "memory_delete",
		group: "Памʼять",
		description: "Видалити правило з памʼяті проєкту за id.",
		promptSnippet: "Видалити правило проєкту",
		parameters: memoryDeleteSchema,
		async execute(_id, params: Static<typeof memoryDeleteSchema>) {
			const id = params.id?.trim();
			if (!id) {
				return { content: [{ type: "text", text: "Потрібен id правила (params.id)." }], details: undefined };
			}
			const ok = store.deleteMemory(projectId, id);
			return {
				content: [{ type: "text", text: ok ? `Правило ${id} видалено з памʼяті проєкту.` : `Правило ${id} не знайдено.` }],
				details: undefined,
			};
		},
	};

	return [wrapToolDefinition(saveDef), wrapToolDefinition(deleteDef)];
}

/**
 * Побудувати секцію авто-інжекту памʼяті проєкту для system-prompt.
 * Повертає "" якщо памʼяті нема (інжект лише коли items непорожні).
 */
export function buildMemoryPromptSection(projectId: string, store: ProjectStore): string {
	const items = store.getMemory(projectId);
	if (items.length === 0) return "";
	const rules = items.map((i) => `- ${i.text}`).join("\n");
	return `\n\n## Правила проєкту (виконуй обовʼязково)\n${rules}\n\n## Коли юзер каже «запамʼятай/remember X» — викликай memory_save(X) (зберегти як правило проєкту).`;
}
