/**
 * Headless-типи для інструментів агента.
 *
 * На відміну від pi-донора, тут немає TUI: ToolDefinition не містить
 * renderCall/renderResult/Theme, а 5-й параметр execute — мінімальний ToolContext
 * замість важкого ExtensionContext (який тягнув session-manager/TUI).
 */

import type { AgentToolResult, AgentToolUpdateCallback, StreamFn, ToolExecutionMode } from "@coudycode/agent-core";
import type { Api, Model } from "@coudycode/ai";
import type { Static, TSchema } from "typebox";

/**
 * Мінімальний контекст інструменту. Лише те, що реально використовується
 * в execute-тілах (read → ctx.model для vision-підтримки). Решта 7 інструментів
 * його ігнорують.
 */
export interface ToolContext {
	/** Поточна модель (для перевірки vision-підтримки в read). */
	model?: Model<Api>;
	/** Stream-функція (для sub-agent/analyze-подібних інструментів — зарезервовано). */
	getStreamFn?: () => StreamFn;
}

/**
 * Фабрика контексту (прокидається у wrapToolDefinitions). За замовчуванням — undefined,
 * тоді execute отримує undefined (інструменти коректно обробляють відсутність ctx).
 */
export type ToolContextFactory = () => ToolContext | undefined;

/**
 * Headless-визначення інструменту. Без TUI-рендерерів.
 */
export interface ToolDefinition<
	TParams extends TSchema = TSchema,
	TDetails = unknown,
	TState = unknown,
> {
	name: string;
	label: string;
	description: string;
	/** Група тулза для UI-селектора («standard» = базові; інакше — id плагіна). */
	group?: string;
	promptSnippet?: string;
	promptGuidelines?: string[];
	parameters: TParams;
	renderShell?: "default" | "self";
	prepareArguments?: (args: unknown) => Static<TParams>;
	executionMode?: ToolExecutionMode;
	execute(
		toolCallId: string,
		params: Static<TParams>,
		signal: AbortSignal | undefined,
		onUpdate: AgentToolUpdateCallback<TDetails> | undefined,
		ctx: ToolContext | undefined,
	): Promise<AgentToolResult<TDetails>>;
}
