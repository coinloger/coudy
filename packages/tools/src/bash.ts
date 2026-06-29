import { constants } from "node:fs";
import { access as fsAccess } from "node:fs/promises";
import type { AgentTool } from "@coudycode/agent-core";
import { spawn } from "child_process";
import { type Static, Type } from "typebox";
import { waitForChildProcess } from "./utils/child-process.ts";
import {
	getShellConfig,
	getShellEnv,
	killProcessTree,
	trackDetachedChildPid,
	untrackDetachedChildPid,
} from "./utils/shell.ts";
import type { ToolDefinition } from "./types.ts";
import { OutputAccumulator } from "./output-accumulator.ts";
import { getTextOutput, invalidArgText, str } from "./render-utils.ts";
import { wrapToolDefinition } from "./tool-definition-wrapper.ts";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, formatSize, type TruncationResult } from "./truncate.ts";

const bashSchema = Type.Object({
	command: Type.String({ description: "Bash command to execute" }),
	timeout: Type.Number({
		description:
			"Максимальний час виконання в секундах. ОБОВ'ЯЗКОВИЙ — без нього команду не буде запущено. " +
			"Орієнтири: швидкі інспекційні команди (ls, echo, pwd, git status) — 10–30, " +
			"збірка/тести — 120–300, важкі білди — до 600. Команду прибито timeout-ом буде вбито.",
	}),
});

export type BashToolInput = Static<typeof bashSchema>;

export interface BashToolDetails {
	truncation?: TruncationResult;
	fullOutputPath?: string;
}

/**
 * Pluggable operations for the bash tool.
 * Override these to delegate command execution to remote systems (for example SSH).
 */
export interface BashOperations {
	/**
	 * Execute a command and stream output.
	 * @param command The command to execute
	 * @param cwd Working directory
	 * @param options Execution options
	 * @returns Promise resolving to exit code (null if killed)
	 */
	exec: (
		command: string,
		cwd: string,
		options: {
			onData: (data: Buffer) => void;
			signal?: AbortSignal;
			timeout?: number;
			env?: NodeJS.ProcessEnv;
		},
	) => Promise<{ exitCode: number | null }>;
}

/**
 * Create bash operations using pi's built-in local shell execution backend.
 *
 * This is useful for extensions that intercept user_bash and still want pi's
 * standard local shell behavior while wrapping or rewriting commands.
 */
/** Інформація про спавнений процес (для реєстру процесів агента). */
export interface BashProcessInfo {
	pid: number;
	/** Лідер процесної групи; на Unix (detached) === pid. */
	pgid: number;
	command: string;
	cwd: string;
}

/** Хук, що викликається одразу після spawn bash-процесу (для реєстру). */
export type BashOnSpawnHook = (info: BashProcessInfo) => void;
/** Хук, що викликається після завершення bash-команди (анти-сирота). */
export type BashOnCompleteHook = (info: BashProcessInfo & { exitCode: number | null }) => void;

export function createLocalBashOperations(options?: {
	shellPath?: string;
	onSpawn?: BashOnSpawnHook;
	onComplete?: BashOnCompleteHook;
}): BashOperations {
	const onSpawn = options?.onSpawn;
	const onComplete = options?.onComplete;
	return {
		exec: async (command, cwd, { onData, signal, timeout, env }) => {
			const { shell, args } = getShellConfig(options?.shellPath);
			try {
				await fsAccess(cwd, constants.F_OK);
			} catch {
				throw new Error(`Working directory does not exist: ${cwd}\nCannot execute bash commands.`);
			}
			if (signal?.aborted) {
				throw new Error("aborted");
			}

			const child = spawn(shell, [...args, command], {
				cwd,
				detached: process.platform !== "win32",
				env: env ?? getShellEnv(),
				stdio: ["ignore", "pipe", "pipe"],
				windowsHide: true,
			});
			if (child.pid) {
				trackDetachedChildPid(child.pid);
				// Реєстр процесів: pgid = pid на Unix (detached → лідер групи).
				onSpawn?.({ pid: child.pid, pgid: child.pid, command, cwd });
			}
			let timedOut = false;
			let timeoutHandle: NodeJS.Timeout | undefined;
			const onAbort = () => {
				if (child.pid) killProcessTree(child.pid);
			};

			try {
				// Timeout may be provided by the caller (BashOperations is pluggable;
				// the bash tool always passes a validated positive value from the schema).
				if (timeout !== undefined && timeout > 0) {
					timeoutHandle = setTimeout(() => {
						timedOut = true;
						if (child.pid) killProcessTree(child.pid);
					}, timeout * 1000);
				}
				// Stream stdout and stderr.
				child.stdout?.on("data", onData);
				child.stderr?.on("data", onData);
				// Handle abort signal by killing the entire process tree.
				if (signal) {
					if (signal.aborted) onAbort();
					else signal.addEventListener("abort", onAbort, { once: true });
				}
				// Handle shell spawn errors and wait for the process to terminate without hanging
				// on inherited stdio handles held by detached descendants.
				const exitCode = await waitForChildProcess(child);
				// Анти-сирота: після завершення команди дати реєстру перевірити групу
				// (фонова `&` ще жива → залишити; інакше прибрати).
				if (child.pid) onComplete?.({ pid: child.pid, pgid: child.pid, command, cwd, exitCode });
				if (signal?.aborted) {
					throw new Error("aborted");
				}
				if (timedOut) {
					throw new Error(`timeout:${timeout}`);
				}
				return { exitCode };
			} finally {
				if (child.pid) untrackDetachedChildPid(child.pid);
				if (timeoutHandle) clearTimeout(timeoutHandle);
				if (signal) signal.removeEventListener("abort", onAbort);
			}
		},
	};
}

export interface BashSpawnContext {
	command: string;
	cwd: string;
	env: NodeJS.ProcessEnv;
}

export type BashSpawnHook = (context: BashSpawnContext) => BashSpawnContext;

function resolveSpawnContext(command: string, cwd: string, spawnHook?: BashSpawnHook): BashSpawnContext {
	const baseContext: BashSpawnContext = { command, cwd, env: { ...getShellEnv() } };
	return spawnHook ? spawnHook(baseContext) : baseContext;
}

export interface BashToolOptions {
	/** Custom operations for command execution. Default: local shell */
	operations?: BashOperations;
	/** Command prefix prepended to every command (for example shell setup commands) */
	commandPrefix?: string;
	/** Optional explicit shell path from settings */
	shellPath?: string;
	/** Hook to adjust command, cwd, or env before execution */
	spawnHook?: BashSpawnHook;
	/** Хук після spawn (для реєстру процесів агента). Лише з дефолтними operations. */
	onSpawn?: BashOnSpawnHook;
	/** Хук після завершення команди (анти-сирота). Лише з дефолтними operations. */
	onComplete?: BashOnCompleteHook;
	/** Hard cap для timeout (секунди). Передається через .pi/config.json. */
	maxTimeoutSec?: number;
}

const BASH_PREVIEW_LINES = 5;
const BASH_UPDATE_THROTTLE_MS = 100;

function formatDuration(ms: number): string {
	return `${(ms / 1000).toFixed(1)}s`;
}

export function createBashToolDefinition(
	cwd: string,
	options?: BashToolOptions,
): ToolDefinition<typeof bashSchema, BashToolDetails | undefined> {
	const ops =
		options?.operations ??
		createLocalBashOperations({
			shellPath: options?.shellPath,
			onSpawn: options?.onSpawn,
			onComplete: options?.onComplete,
		});
	const commandPrefix = options?.commandPrefix;
	const spawnHook = options?.spawnHook;
	const maxTimeoutSec = options?.maxTimeoutSec;
	return {
		name: "bash",
		label: "bash",
		description:
			`Execute a bash command in the current working directory. Returns stdout and stderr. ` +
			`Output is truncated to last ${DEFAULT_MAX_LINES} lines or ${DEFAULT_MAX_BYTES / 1024}KB (whichever is hit first). ` +
			"If truncated, full output is saved to a temp file. Timeout in seconds is REQUIRED — the command is killed when it expires." +
			(maxTimeoutSec ? ` Timeout має не перевищувати ${maxTimeoutSec}s.` : ""),
		promptSnippet: "Execute bash commands for building, compiling, or running tests",
		promptGuidelines: [
			"DO NOT use bash to run search, find, grep, rg, fd, or locate commands. Use the dedicated 'grep' or 'find' tools instead.",
			"timeout parameter is REQUIRED. Always provide a reasonable timeout: 10–30s for quick inspection, 120–300s for builds/tests, up to 600s for heavy operations." +
				(maxTimeoutSec ? ` Timeout більше ${maxTimeoutSec}s буде відхилено.` : ""),
		],
		parameters: bashSchema,
		async execute(
			_toolCallId,
			{ command, timeout }: { command: string; timeout: number },
			signal?: AbortSignal,
			onUpdate?,
			_ctx?,
		) {
			if (typeof timeout !== "number" || !Number.isFinite(timeout) || timeout <= 0) {
				throw new Error(
					`timeout є обов'язковим і має бути додатним числом секунд (отримано: ${timeout}). ` +
						"Надай timeout — без нього команду не буде запущено.",
				);
			}
			if (maxTimeoutSec !== undefined && timeout > maxTimeoutSec) {
				throw new Error(
					`timeout ${timeout}s перевищує ліміт ${maxTimeoutSec}s. ` +
						`Знизь timeout до ${maxTimeoutSec}s або менше, або попроси власника проєкту підняти ліміт через .pi/config.json.`,
				);
			}
			const resolvedCommand = commandPrefix ? `${commandPrefix}\n${command}` : command;
			const spawnContext = resolveSpawnContext(resolvedCommand, cwd, spawnHook);
			const output = new OutputAccumulator({ tempFilePrefix: "pi-bash" });
			let acceptingOutput = true;
			let updateTimer: NodeJS.Timeout | undefined;
			let updateDirty = false;
			let lastUpdateAt = 0;

			const emitOutputUpdate = () => {
				if (!onUpdate || !updateDirty) return;
				updateDirty = false;
				lastUpdateAt = Date.now();
				const snapshot = output.snapshot({ persistIfTruncated: true });
				onUpdate({
					content: [{ type: "text", text: snapshot.content || "" }],
					details: {
						truncation: snapshot.truncation.truncated ? snapshot.truncation : undefined,
						fullOutputPath: snapshot.fullOutputPath,
					},
				});
			};

			const clearUpdateTimer = () => {
				if (updateTimer) {
					clearTimeout(updateTimer);
					updateTimer = undefined;
				}
			};

			const scheduleOutputUpdate = () => {
				if (!onUpdate) return;
				updateDirty = true;
				const delay = BASH_UPDATE_THROTTLE_MS - (Date.now() - lastUpdateAt);
				if (delay <= 0) {
					clearUpdateTimer();
					emitOutputUpdate();
					return;
				}
				updateTimer ??= setTimeout(() => {
					updateTimer = undefined;
					emitOutputUpdate();
				}, delay);
			};

			if (onUpdate) {
				onUpdate({ content: [], details: undefined });
			}

			const handleData = (data: Buffer) => {
				if (!acceptingOutput) return;
				output.append(data);
				scheduleOutputUpdate();
			};

			const finishOutput = async () => {
				acceptingOutput = false;
				output.finish();
				clearUpdateTimer();
				emitOutputUpdate();
				const snapshot = output.snapshot({ persistIfTruncated: true });
				await output.closeTempFile();
				return snapshot;
			};

			const formatOutput = (snapshot: Awaited<ReturnType<typeof finishOutput>>, emptyText = "(no output)") => {
				const truncation = snapshot.truncation;
				let text = snapshot.content || emptyText;
				let details: BashToolDetails | undefined;
				if (truncation.truncated) {
					details = { truncation, fullOutputPath: snapshot.fullOutputPath };
					const startLine = truncation.totalLines - truncation.outputLines + 1;
					const endLine = truncation.totalLines;
					if (truncation.lastLinePartial) {
						const lastLineSize = formatSize(output.getLastLineBytes());
						text += `\n\n[Showing last ${formatSize(truncation.outputBytes)} of line ${endLine} (line is ${lastLineSize}). Full output: ${snapshot.fullOutputPath}]`;
					} else if (truncation.truncatedBy === "lines") {
						text += `\n\n[Showing lines ${startLine}-${endLine} of ${truncation.totalLines}. Full output: ${snapshot.fullOutputPath}]`;
					} else {
						text += `\n\n[Showing lines ${startLine}-${endLine} of ${truncation.totalLines} (${formatSize(DEFAULT_MAX_BYTES)} limit). Full output: ${snapshot.fullOutputPath}]`;
					}
				}
				return { text, details };
			};

			const appendStatus = (text: string, status: string) => `${text ? `${text}\n\n` : ""}${status}`;

			try {
				let exitCode: number | null;
				try {
					const result = await ops.exec(spawnContext.command, spawnContext.cwd, {
						onData: handleData,
						signal,
						timeout,
						env: spawnContext.env,
					});
					exitCode = result.exitCode;
				} catch (err) {
					const snapshot = await finishOutput();
					const { text } = formatOutput(snapshot, "");
					if (err instanceof Error && err.message === "aborted") {
						throw new Error(appendStatus(text, "Command aborted"));
					}
					if (err instanceof Error && err.message.startsWith("timeout:")) {
						const timeoutSecs = err.message.split(":")[1];
						throw new Error(appendStatus(text, `Command timed out after ${timeoutSecs} seconds`));
					}
					throw err;
				}

				const snapshot = await finishOutput();
				const { text: outputText, details } = formatOutput(snapshot);
				if (exitCode !== 0 && exitCode !== null) {
					throw new Error(appendStatus(outputText, `Command exited with code ${exitCode}`));
				}
				return { content: [{ type: "text", text: outputText }], details };
			} finally {
				clearUpdateTimer();
			}
		},
	};
}

export function createBashTool(cwd: string, options?: BashToolOptions): AgentTool<typeof bashSchema> {
	return wrapToolDefinition(createBashToolDefinition(cwd, options));
}
