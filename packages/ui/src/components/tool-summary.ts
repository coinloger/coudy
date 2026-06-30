/**
 * Генератори людяних описів дій інструментів (Claude Code-стайл)
 * з tool-name + arguments. Використовуються в компактних summary-рядках.
 */
import type { ToolCall } from "@coudycode/ai";

/** Взяти basename шляху (без директорії). */
export function basename(p: string): string {
	if (!p) return p;
	const parts = p.replace(/\\/g, "/").split("/").filter(Boolean);
	return parts[parts.length - 1] ?? p;
}

/** Ім'я хосту з URL. */
function hostname(url: string): string {
	try {
		return new URL(url).hostname;
	} catch {
		return url;
	}
}

/** Літерал для дії інструменту: "Reading", "Editing", … (дієприкметник/герундій). */
export type ToolActionVerb =
	| "Reading"
	| "Editing"
	| "Writing"
	| "Running"
	| "Searching"
	| "Finding"
	| "Listing"
	| "Fetching"
	| "Analyzing"
	| "Compacting";

export const TOOL_VERB: Record<string, ToolActionVerb> = {
	read: "Reading",
	edit: "Editing",
	write: "Writing",
	bash: "Running",
	grep: "Searching",
	find: "Finding",
	ls: "Listing",
	fetch: "Fetching",
	analyze: "Analyzing",
	compact: "Compacting",
};

/** Коротке людяне описове слово для типу (для агрегованого summary). */
function shortLabel(name: string): { singular: string; plural: string; verb: ToolActionVerb } {
	switch (name) {
		case "read":
			return { singular: "file", plural: "files", verb: "Reading" };
		case "edit":
			return { singular: "edit", plural: "edits", verb: "Editing" };
		case "write":
			return { singular: "file", plural: "files", verb: "Writing" };
		case "grep":
			return { singular: "search", plural: "searches", verb: "Searching" };
		case "find":
			return { singular: "find", plural: "finds", verb: "Finding" };
		case "bash":
			return { singular: "command", plural: "commands", verb: "Running" };
		case "ls":
			return { singular: "listing", plural: "listings", verb: "Listing" };
		case "fetch":
			return { singular: "fetch", plural: "fetches", verb: "Fetching" };
		case "analyze":
			return { singular: "analysis", plural: "analyses", verb: "Analyzing" };
		case "compact":
			return { singular: "compaction", plural: "compactions", verb: "Compacting" };
		default:
			return { singular: name, plural: name, verb: TOOL_VERB[name] ?? ("Running" as ToolActionVerb) };
	}
}

/**
 * Згенерувати компактний опис конкретного виклику: "Reading package.json", "cat package.json",
 * 'Searching for "hooks" in packages/core/src'.
 */
export function describeToolCall(call: ToolCall): string {
	const a = (call.arguments ?? {}) as Record<string, unknown>;
	switch (call.name) {
		case "read":
		case "edit":
		case "write": {
			const path = strArg(a.path) ?? strArg(a.file_path);
			return `${TOOL_VERB[call.name]} ${path ? basename(path) : "…"}`;
		}
		case "bash": {
			const cmd = strArg(a.command);
			const clean = cmd ? cmd.replace(/^\$\s*/, "").trim() : "";
			return clean ? `Running ${clean}` : "Running command";
		}
		case "grep": {
			const pattern = strArg(a.pattern);
			const path = strArg(a.path) ?? strArg(a.glob);
			const base = pattern ? `Searching for "${pattern}"` : "Searching";
			return path ? `${base} in ${path}` : base;
		}
		case "find": {
			const pattern = strArg(a.pattern) ?? strArg(a.glob);
			return pattern ? `Finding ${pattern}` : "Finding files";
		}
		case "ls": {
			const path = strArg(a.path);
			return path ? `Listing ${path}` : "Listing directory";
		}
		case "fetch": {
			const url = strArg(a.url);
			return url ? `Fetching ${hostname(url)}` : "Fetching";
		}
		case "analyze": {
			const count = numArg(a.messageCount) ?? numArg(a.count);
			const scope = strArg(a.scope);
			if (count !== undefined) return `Analyzing ${count} messages${scope ? ` (${scope})` : ""}`;
			return scope ? `Analyzing ${scope}` : "Analyzing context";
		}
		case "compact":
			return "Compacting context";
		// ===== Бібліотека / сесійні скрипти =====
		case "library_search": {
			const q = strArg(a.query);
			return q ? `Searching library for "${truncate(q, 40)}"` : "Searching library";
		}
		case "library_call":
		case "session_script_call": {
			const fn = strArg(a.name);
			const scope = call.name.startsWith("session") ? "session script" : "library fn";
			return fn ? `Calling ${scope} ${fn}` : `Calling ${scope}`;
		}
		case "library_create": {
			const fn = strArg(a.name);
			return fn ? `Creating library fn ${fn}` : "Creating library fn";
		}
		case "library_modify": {
			const fn = strArg(a.name);
			return fn ? `Modifying library fn ${fn}` : "Modifying library fn";
		}
		case "library_list":
			return "Listing library";
		case "session_script_create": {
			const fn = strArg(a.name);
			return fn ? `Creating session script ${fn}` : "Creating session script";
		}
		case "session_script_modify": {
			const fn = strArg(a.name);
			return fn ? `Modifying session script ${fn}` : "Modifying session script";
		}
		case "session_script_list":
			return "Listing session scripts";
		case "promote_to_global": {
			const fn = strArg(a.name);
			return fn ? `Promoting ${fn} to global` : "Promoting to global";
		}
		case "processes": {
			const action = strArg(a.action);
			return action === "kill" ? "Killing process" : "Managing processes";
		}
		default:
			return call.name;
	}
}

/**
 * Превʼю для detail-рядка ⎿ під summary: шлях файлу / команда / патерн.
 */
export function toolCallPreview(call: ToolCall): string {
	const a = (call.arguments ?? {}) as Record<string, unknown>;
	switch (call.name) {
		case "read":
		case "edit":
		case "write": {
			const path = strArg(a.path) ?? strArg(a.file_path);
			return path ? `${TOOL_VERB[call.name].replace("ing", "")} ${path}` : call.name;
		}
		case "bash": {
			const cmd = strArg(a.command);
			return cmd ? `$ ${cmd.replace(/^\$\s*/, "").trim()}` : "command";
		}
		case "grep": {
			const pattern = strArg(a.pattern);
			const path = strArg(a.path);
			return pattern ? `grep "${pattern}"${path ? ` in ${path}` : ""}` : "grep";
		}
		case "find": {
			const pattern = strArg(a.pattern);
			return pattern ? `find ${pattern}` : "find";
		}
		case "ls": {
			const path = strArg(a.path);
			return path ? `ls ${path}` : "ls";
		}
		case "fetch": {
			const url = strArg(a.url);
			return url ?? "fetch";
		}
		case "analyze": {
			const count = numArg(a.messageCount) ?? numArg(a.count);
			const scope = strArg(a.scope);
			if (count !== undefined) return `analyze ${count} messages`;
			return `analyze ${scope ?? "context"}`;
		}
		case "compact": {
			const tokens = numArg(a.tokensBefore);
			return tokens !== undefined ? `Compacted ${tokens} tokens` : "compact context";
		}
		// ===== Бібліотека / сесійні скрипти: peek = ДЕТАЛІ (не дія) =====
		case "library_search": {
			const q = strArg(a.query);
			return q ? `query: ${truncate(q, 60)}` : call.name;
		}
		case "library_list":
		case "session_script_list":
			return call.name;
		case "library_call":
		case "session_script_call": {
			const fn = strArg(a.name);
			const p = a.params && typeof a.params === "object" ? JSON.stringify(a.params) : "";
			return p ? `${fn ?? call.name}(${truncate(p, 60)})` : (fn ?? call.name);
		}
		case "library_create":
		case "library_modify":
		case "session_script_create":
		case "session_script_modify": {
			const fn = strArg(a.name);
			// peek показує мету з title/description якщо є в code-meta, інакше fn-імʼя.
			const code = strArg(a.code);
			if (code) {
				const m = code.match(/title:\s*"([^"]+)"/);
				if (m) return m[1] ?? (fn ?? call.name);
			}
			return fn ?? call.name;
		}
		case "promote_to_global": {
			const fn = strArg(a.name);
			const cat = strArg(a.category);
			return cat ? `${fn ?? call.name} → ${cat}` : (fn ?? call.name);
		}
		case "processes": {
			const action = strArg(a.action);
			const pid = numArg(a.pid);
			return pid !== undefined ? `${action ?? "list"} pid=${pid}` : (action ?? "list");
		}
		default:
			return call.name;
	}
}

/**
 * Згенерувати агрегований summary для групи tool-call'ів.
 * Однотипні → "Reading 6 files"; різні → "Reading 3 files, editing 2 files, …".
 */
export function describeToolGroup(calls: ToolCall[]): string {
	if (calls.length === 0) return "";
	// Якщо один — звичайний опис.
	if (calls.length === 1) return describeToolCall(calls[0]);

	// Розбити за типом.
	const byType = new Map<string, ToolCall[]>();
	for (const c of calls) {
		const arr = byType.get(c.name) ?? [];
		arr.push(c);
		byType.set(c.name, arr);
	}

	const parts: string[] = [];
	for (const [name, group] of byType) {
		const label = shortLabel(name);
		if (group.length === 1) {
			// Одиничний внесок у змішаній групі.
			parts.push(`${label.verb} 1 ${label.singular}`);
		} else {
			parts.push(`${label.verb} ${group.length} ${label.plural}`);
		}
	}

	// Якщо все одного типу — стисло: "Reading 6 files".
	if (byType.size === 1) {
		const [name, group] = [...byType][0];
		const label = shortLabel(name);
		return `${label.verb} ${group.length} ${label.plural}`;
	}
	return parts.join(", ");
}

function strArg(v: unknown): string | undefined {
	return typeof v === "string" && v.length > 0 ? v : undefined;
}

function numArg(v: unknown): number | undefined {
	if (typeof v === "number" && Number.isFinite(v)) return v;
	if (typeof v === "string" && /^\d+$/.test(v.trim())) return Number(v);
	return undefined;
}

/** Обрізати рядок до max символів з ellipsis. */
function truncate(s: string, max: number): string {
	return s.length > max ? s.slice(0, max - 1) + "…" : s;
}
