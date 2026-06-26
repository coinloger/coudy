/**
 * @coudycode/tools — headless-інструменти агента (без TUI).
 *
 * Експортує фабрики, що повертають AgentTool[] для runAgentLoop
 * (з @coudycode/agent-core), плюс окремі інструменти та типи.
 */

import type { AgentTool } from "@coudycode/agent-core";
import {
	type BashToolOptions,
	createBashTool,
	createBashToolDefinition,
} from "./bash.ts";
import {
	createEditTool,
	createEditToolDefinition,
	type EditToolOptions,
} from "./edit.ts";
import {
	createFetchTool,
	createFetchToolDefinition,
	type FetchToolDetails,
} from "./fetch.ts";
import {
	createFindTool,
	createFindToolDefinition,
	type FindToolOptions,
} from "./find.ts";
import {
	createGrepTool,
	createGrepToolDefinition,
	type GrepToolOptions,
} from "./grep.ts";
import {
	createLsTool,
	createLsToolDefinition,
	type LsToolOptions,
} from "./ls.ts";
import {
	createReadTool,
	createReadToolDefinition,
	type ReadToolOptions,
} from "./read.ts";
import {
	createWriteTool,
	createWriteToolDefinition,
	type WriteToolOptions,
} from "./write.ts";

export type Tool = AgentTool<any>;

export type ToolName = "read" | "bash" | "edit" | "write" | "grep" | "find" | "ls" | "fetch";

export const allToolNames: Set<ToolName> = new Set([
	"read",
	"bash",
	"edit",
	"write",
	"grep",
	"find",
	"ls",
	"fetch",
]);

export interface ToolsOptions {
	read?: ReadToolOptions;
	bash?: BashToolOptions;
	write?: WriteToolOptions;
	edit?: EditToolOptions;
	grep?: GrepToolOptions;
	find?: FindToolOptions;
	ls?: LsToolOptions;
}

/** Створити окремий інструмент за іменем. */
export function createTool(toolName: ToolName, cwd: string, options?: ToolsOptions): Tool {
	switch (toolName) {
		case "read":
			return createReadTool(cwd, options?.read);
		case "bash":
			return createBashTool(cwd, options?.bash);
		case "edit":
			return createEditTool(cwd, options?.edit);
		case "write":
			return createWriteTool(cwd, options?.write);
		case "grep":
			return createGrepTool(cwd, options?.grep);
		case "find":
			return createFindTool(cwd, options?.find);
		case "ls":
			return createLsTool(cwd, options?.ls);
		case "fetch":
			return createFetchTool();
		default:
			throw new Error(`Unknown tool name: ${toolName}`);
	}
}

/** Усі інструменти, що змінюють стан (read/bash/edit/write). */
export function createCodingTools(cwd: string, options?: ToolsOptions): Tool[] {
	return [
		createReadTool(cwd, options?.read),
		createBashTool(cwd, options?.bash),
		createEditTool(cwd, options?.edit),
		createWriteTool(cwd, options?.write),
	];
}

/** Усі read-only інструменти (read/grep/find/ls). */
export function createReadOnlyTools(cwd: string, options?: ToolsOptions): Tool[] {
	return [
		createReadTool(cwd, options?.read),
		createGrepTool(cwd, options?.grep),
		createFindTool(cwd, options?.find),
		createLsTool(cwd, options?.ls),
	];
}

/**
 * Усі 8 інструментів (read/bash/edit/write/grep/find/ls/fetch) → AgentTool[]
 * для runAgentLoop. Готова фабрика для agent-runtime.
 */
export function createAllTools(cwd: string, options?: ToolsOptions): Tool[] {
	return [
		createReadTool(cwd, options?.read),
		createBashTool(cwd, options?.bash),
		createEditTool(cwd, options?.edit),
		createWriteTool(cwd, options?.write),
		createGrepTool(cwd, options?.grep),
		createFindTool(cwd, options?.find),
		createLsTool(cwd, options?.ls),
		createFetchTool(),
	];
}

export {
	createBashTool,
	createBashToolDefinition,
	type BashToolDetails,
	type BashToolInput,
	type BashToolOptions,
} from "./bash.ts";
export {
	createEditTool,
	createEditToolDefinition,
	type EditToolDetails,
	type EditToolInput,
	type EditToolOptions,
} from "./edit.ts";
export { createFetchTool, createFetchToolDefinition, type FetchToolDetails, type FetchToolInput } from "./fetch.ts";
export {
	createFindTool,
	createFindToolDefinition,
	type FindToolDetails,
	type FindToolInput,
	type FindToolOptions,
} from "./find.ts";
export {
	createGrepTool,
	createGrepToolDefinition,
	type GrepToolDetails,
	type GrepToolInput,
	type GrepToolOptions,
} from "./grep.ts";
export {
	createLsTool,
	createLsToolDefinition,
	type LsToolDetails,
	type LsToolInput,
	type LsToolOptions,
} from "./ls.ts";
export {
	createReadTool,
	createReadToolDefinition,
	type ReadToolDetails,
	type ReadToolInput,
	type ReadToolOptions,
} from "./read.ts";
export {
	createWriteTool,
	createWriteToolDefinition,
	type WriteToolInput,
	type WriteToolOptions,
} from "./write.ts";

export type { ToolContext, ToolContextFactory, ToolDefinition } from "./types.ts";
export {
	wrapToolDefinition,
	wrapToolDefinitions,
} from "./tool-definition-wrapper.ts";
