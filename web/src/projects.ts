import { useCallback, useEffect, useState } from "react";

/** Проєкт-контейнер сесій (GET /api/projects). */
export interface Project {
	id: string;
	name: string;
	createdAt: string;
}

/** Правило памʼяті проєкту (GET /api/projects/:id/memory). */
export interface MemoryItem {
	id: string;
	text: string;
	createdAt: string;
}

/** Список проєктів. */
export async function listProjects(): Promise<Project[]> {
	try {
		const r = await fetch("/api/projects");
		if (!r.ok) return [];
		const data = (await r.json()) as { projects?: Project[] };
		return data.projects ?? [];
	} catch {
		return [];
	}
}

/** Створити проєкт. */
export async function createProject(name: string): Promise<Project | null> {
	const r = await fetch("/api/projects", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ name }),
	});
	if (!r.ok) return null;
	return (await r.json()) as Project;
}

/** Перейменувати проєкт. */
export async function renameProject(id: string, name: string): Promise<Project | null> {
	const r = await fetch(`/api/projects/${encodeURIComponent(id)}`, {
		method: "PATCH",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ name }),
	});
	if (!r.ok) return null;
	return (await r.json()) as Project;
}

/** Видалити проєкт (сесії стають loose). */
export async function deleteProject(id: string): Promise<boolean> {
	const r = await fetch(`/api/projects/${encodeURIComponent(id)}`, { method: "DELETE" });
	return r.ok;
}

/** Памʼять проєкту (список правил). */
export async function getMemory(projectId: string): Promise<MemoryItem[]> {
	try {
		const r = await fetch(`/api/projects/${encodeURIComponent(projectId)}/memory`);
		if (!r.ok) return [];
		const data = (await r.json()) as { items?: MemoryItem[] };
		return data.items ?? [];
	} catch {
		return [];
	}
}

/** Видалити правило памʼяті. */
export async function deleteMemoryItem(projectId: string, itemId: string): Promise<boolean> {
	const r = await fetch(
		`/api/projects/${encodeURIComponent(projectId)}/memory/${encodeURIComponent(itemId)}`,
		{ method: "DELETE" },
	);
	return r.ok;
}

/**
 * useProjects — список проєктів + refresh. Сесії проєктів групуються клієнтськи
 * (у Sidebar з загального списку сесій за полем projectId).
 */
export function useProjects(): {
	projects: Project[];
	refresh: () => Promise<void>;
	create: (name: string) => Promise<Project | null>;
	remove: (id: string) => Promise<boolean>;
	rename: (id: string, name: string) => Promise<Project | null>;
} {
	const [projects, setProjects] = useState<Project[]>([]);

	const refresh = useCallback(async (): Promise<void> => {
		setProjects(await listProjects());
	}, []);

	useEffect(() => {
		void refresh();
	}, [refresh]);

	const create = useCallback(
		async (name: string): Promise<Project | null> => {
			const p = await createProject(name);
			if (p) await refresh();
			return p;
		},
		[refresh],
	);

	const remove = useCallback(
		async (id: string): Promise<boolean> => {
			const ok = await deleteProject(id);
			if (ok) await refresh();
			return ok;
		},
		[refresh],
	);

	const rename = useCallback(
		async (id: string, name: string): Promise<Project | null> => {
			const p = await renameProject(id, name);
			if (p) await refresh();
			return p;
		},
		[refresh],
	);

	return { projects, refresh, create, remove, rename };
}
