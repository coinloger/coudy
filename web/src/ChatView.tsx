import { useCallback, useEffect, useRef, useState } from "react";
import { Send, Square, Gauge, Layers } from "lucide-react";
import type { AgentEvent, AgentMessage } from "@coudycode/agent-core";
import type { ToolCall as ToolCallContent } from "@coudycode/ai";
import {
	ConversationView,
	applyEvent,
	initialConversationState,
	ToolCall,
	type ConversationState,
	type ToolCallStatus,
} from "@coudycode/ui";
import "@coudycode/ui/styles.css";
import { streamChat } from "./chat-stream";
import { ModelSelector, type CurrentModel, type ProviderGroup } from "./ModelSelector";
import { PromptSelector, type PromptTemplateEntry } from "./PromptSelector";
import type { ChatPanel, MessageAction } from "./types";

interface ChatViewProps {
	sessionId: string;
	/** Плагінні панелі чату (ui:chat-panel). */
	chatPanels?: ChatPanel[];
	/** Плагінні дії на повідомленнях (ui:message-actions). */
	messageActions?: MessageAction[];
}

/** Стан компактації як tool call: running → done (з summary). null = не активна. */
interface CompactionState {
	status: "running" | "done";
	summary?: string;
	tokensBefore?: number;
}

/** Синтетичний tool-call «compact» для рендеру через ToolCall. */
function makeCompactCall(state: CompactionState): ToolCallContent {
	return {
		type: "toolCall",
		id: "compact-live",
		name: "compact",
		arguments: { tokensBefore: state.tokensBefore },
	};
}

/** Серверна сесія (GET /api/sessions/:id). */
interface ServerSession {
	id: string;
	name: string | null;
	model: CurrentModel | null;
	contextUsage: { tokensUsed: number; contextWindow: number; pct: number } | null;
	promptTemplate: { id: string; name: string } | null;
	messages: AgentMessage[];
}

/** Чат із реальним агентом (/api/chat SSE) + історія сесії. */
export default function ChatView({ sessionId, chatPanels = [], messageActions = [] }: ChatViewProps): React.ReactNode {
	// Постійна історія сесії (завантажена з бекенду).
	const [committed, setCommitted] = useState<AgentMessage[]>([]);
	const [committedStatus, setCommittedStatus] = useState<Record<string, ToolCallStatus>>({});
	const [title, setTitle] = useState<string>("Чат");
	const [contextUsage, setContextUsage] = useState<{
		tokensUsed: number;
		contextWindow: number;
		pct: number;
	} | null>(null);
	// Поточний хід (стрімиться).
	const [live, setLive] = useState<ConversationState>(initialConversationState);

	const [input, setInput] = useState("");
	const [running, setRunning] = useState(false);
	const [compaction, setCompaction] = useState<CompactionState | null>(null);
	const [panelsOpen, setPanelsOpen] = useState(true);
	const [error, setError] = useState<string | null>(null);

	// Вибір моделі (поточна + каталог підключених провайдерів).
	const [currentModel, setCurrentModel] = useState<CurrentModel | null>(null);
	const [catalog, setCatalog] = useState<ProviderGroup[]>([]);
	// Вибір шаблону системного промпту (per-session).
	const [currentPrompt, setCurrentPrompt] = useState<{ id: string; name: string } | null>(null);
	const [promptTemplates, setPromptTemplates] = useState<PromptTemplateEntry[]>([]);

	const workingRef = useRef<ConversationState>(initialConversationState);
	const abortRef = useRef<AbortController | null>(null);
	const scrollRef = useRef<HTMLDivElement>(null);
	const stickRef = useRef(true);

	const messages: AgentMessage[] = [...committed, ...live.messages];
	const toolStatus: Record<string, ToolCallStatus> = { ...committedStatus, ...live.toolStatus };

	// Завантажити історію сесії при зміні sessionId.
	const loadSession = useCallback(async () => {
		try {
			const r = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}`);
			if (!r.ok) return;
			const s = (await r.json()) as ServerSession;
			setCommitted(s.messages ?? []);
			setCommittedStatus({});
			setTitle(s.name ?? "Чат");
			setCurrentModel(s.model ?? null);
			setContextUsage(s.contextUsage ?? null);
			setCurrentPrompt(s.promptTemplate ?? null);
			setLive(initialConversationState);
			workingRef.current = initialConversationState;
			setCompaction(null);
			setError(null);
			stickRef.current = true;
		} catch {
			/* ignore */
		}
	}, [sessionId]);

	/** Оновити лише метадані сесії (contextUsage/title) після відповіді — легший рефетч. */
	const refreshSessionMeta = useCallback(async () => {
		try {
			const r = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}`);
			if (!r.ok) return;
			const s = (await r.json()) as ServerSession;
			setContextUsage(s.contextUsage ?? null);
			setTitle(s.name ?? "Чат");
		} catch {
			/* ignore */
		}
	}, [sessionId]);

	useEffect(() => {
		void loadSession();
	}, [loadSession]);

	// Завантажити каталог підключених провайдерів + шаблони промптів (модель сесії через loadSession).
	useEffect(() => {
		let cancelled = false;
		void fetch("/api/models")
			.then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
			.then((data: { providers: ProviderGroup[] }) => data.providers ?? [])
			.catch(() => [] as ProviderGroup[])
			.then((catalog) => {
				if (!cancelled) setCatalog(catalog);
			});
		void fetch("/api/prompts")
			.then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
			.then((data: { templates: PromptTemplateEntry[] }) => data.templates ?? [])
			.catch(() => [] as PromptTemplateEntry[])
			.then((templates) => {
				if (!cancelled) setPromptTemplates(templates);
			});
		return () => {
			cancelled = true;
		};
	}, []);

	// Обрати шаблон промпту → зберегти привʼязку (POST /api/sessions/:id/prompt-template).
	const handleSelectPrompt = (templateId: string | null): void => {
		void fetch(`/api/sessions/${encodeURIComponent(sessionId)}/prompt-template`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ templateId }),
		})
			.then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
			.then((s: { promptTemplate?: { id: string; name: string } | null }) => {
				setCurrentPrompt(s.promptTemplate ?? null);
			})
			.catch(() => undefined);
	};

	// Обрати модель → зберегти в сесію (POST /api/sessions/:id/model).
	const handleSelectModel = (provider: string, modelId: string): void => {
		void fetch(`/api/sessions/${encodeURIComponent(sessionId)}/model`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ provider, modelId }),
		})
			.then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
			.then((s: {
				model?: CurrentModel | null;
				contextUsage?: { tokensUsed: number; contextWindow: number; pct: number } | null;
			}) => {
				setCurrentModel(s.model ?? { provider, modelId, label: modelId });
				if (s.contextUsage) setContextUsage(s.contextUsage);
			})
			.catch(() => undefined);
	};

	// Авто-скрол, якщо користувач біля низу.
	useEffect(() => {
		const el = scrollRef.current;
		if (el && stickRef.current) {
			el.scrollTo({ top: el.scrollHeight, behavior: "auto" });
		}
	}, [messages, live.streamingMessage]);

	const onEvent = (event: AgentEvent): void => {
		if (event.type === "agent_end") {
			// Дописати акумульовані повідомлення ходу в історію.
			const turn = workingRef.current;
			setCommitted((prev) => [...prev, ...turn.messages]);
			setCommittedStatus((prev) => ({ ...prev, ...turn.toolStatus }));
			workingRef.current = initialConversationState;
			setLive(initialConversationState);
			// Оновити contextUsage/title після відповіді агента.
			void refreshSessionMeta();
			return;
		}
		// session_compact (від AgentHarness): позначити tool call done + оновити сесію.
		// @ts-expect-error — session_compact є AgentHarnessEvent, не базовий AgentEvent на клієнті.
		if (event.type === "session_compact") {
			const entry = (event as { compactionEntry?: { summary?: string; tokensBefore?: number } }).compactionEntry;
			setCompaction({
				status: "done",
				summary: entry?.summary,
				tokensBefore: entry?.tokensBefore,
			});
			void loadSession();
			return;
		}
		// @ts-expect-error — compaction_start від бекенду ДО виклику LLM compact.
		if (event.type === "compaction_start") {
			setCompaction({ status: "running" });
			stickRef.current = true;
			return;
		}
		// @ts-expect-error — error-подія не частина AgentEvent-юніону (бекенд додає {type:"error"}).
		if (event.type === "error" && typeof (event as { message?: string }).message === "string") {
			setError((event as { message: string }).message);
			return;
		}
		workingRef.current = applyEvent(workingRef.current, event);
		setLive({ ...workingRef.current });
	};

	const startStream = (message: string): void => {
		if (!message || running) return;
		setError(null);
		setInput("");
		setRunning(true);
		workingRef.current = initialConversationState;
		// Прелоудер одразу при відправці (до першої AgentEvent / agent_start).
		setLive({ ...initialConversationState, working: true });
		stickRef.current = true;
		const controller = new AbortController();
		abortRef.current = controller;
		streamChat({ sessionId, message, signal: controller.signal }, onEvent)
			.catch(() => {
				/* переривання або помилка мережі */
			})
			.finally(() => {
				// Partial-повідомлення цього ходу комітимо як є (якщо стрім обірвався до agent_end).
				const turn = workingRef.current;
				if (turn.streamingMessage || turn.messages.length > 0) {
					const msgs = [...turn.messages];
					if (turn.streamingMessage) msgs.push(turn.streamingMessage);
					const statuses = { ...turn.toolStatus };
					for (const k of Object.keys(statuses)) {
						if (statuses[k] === "running") statuses[k] = "done";
					}
					setCommitted((prev) => [...prev, ...msgs]);
					setCommittedStatus((prev) => ({ ...prev, ...statuses }));
				}
				workingRef.current = initialConversationState;
				setLive(initialConversationState);
				setRunning(false);
				abortRef.current = null;
			});
	};

	const handleStop = (): void => {
		abortRef.current?.abort();
	};

	/** Ручна компактація: POST /api/sessions/:id/compact (SSE) → оновити сесію. */
	const handleCompact = (): void => {
		if (running || compaction) return;
		setCompaction({ status: "running" });
		setRunning(true);
		stickRef.current = true;
		const controller = new AbortController();
		abortRef.current = controller;
		fetch(`/api/sessions/${encodeURIComponent(sessionId)}/compact`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({}),
			signal: controller.signal,
		})
			.then((r) => {
				if (!r.ok || !r.body) throw new Error(`HTTP ${r.status}`);
				const reader = r.body.getReader();
				const decoder = new TextDecoder();
				let buffer = "";
				const pump = (): Promise<void> =>
					reader.read().then(({ done, value }) => {
						if (done) return;
						buffer += decoder.decode(value, { stream: true });
						let idx;
						while ((idx = buffer.indexOf("\n\n")) !== -1) {
							const block = buffer.slice(0, idx);
							buffer = buffer.slice(idx + 2);
							for (const line of block.split("\n")) {
								if (!line.startsWith("data: ")) continue;
								try {
									const ev = JSON.parse(line.slice(6));
									if (ev.type === "compaction_start") {
										setCompaction({ status: "running" });
									} else if (ev.type === "session_compact") {
										setCompaction({
											status: "done",
											summary: ev.compactionEntry?.summary,
											tokensBefore: ev.compactionEntry?.tokensBefore,
										});
										void refreshSessionMeta();
										void loadSession();
									} else if (ev.type === "error") {
										setCompaction(null);
										setError(ev.message);
									}
								} catch {
									/* ignore */
								}
							}
						}
						return pump();
					});
				return pump();
			})
			.catch(() => undefined)
			.finally(() => {
				setRunning(false);
				setCompaction((prev) => (prev?.status === "done" ? prev : null));
				abortRef.current = null;
			});
	};

	const handleSubmit = (e: React.FormEvent): void => {
		e.preventDefault();
		const message = input.trim();
		if (!message) return;
		startStream(message);
	};

	const handleScroll = (): void => {
		const el = scrollRef.current;
		if (!el) return;
		const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 40;
		stickRef.current = atBottom;
	};

	return (
		<div className="d-flex flex-column h-100">
			<div className="border-bottom px-4 py-2 d-flex align-items-center justify-content-between gap-2">
				<h6 className="mb-0 text-truncate">{title}</h6>
				<div className="d-flex align-items-center gap-2">
					{contextUsage && <ContextGauge usage={contextUsage} />}
					{currentModel && (
						<ModelSelector
							current={currentModel}
							catalog={catalog}
							onSelect={handleSelectModel}
						/>
					)}
					<PromptSelector
						current={currentPrompt}
						templates={promptTemplates}
						onSelect={handleSelectPrompt}
					/>
					<button
						type="button"
						className="btn btn-sm btn-outline-secondary d-flex align-items-center gap-1"
						onClick={handleCompact}
						disabled={running || compaction !== null}
						title="Стиснути контекст"
					>
					<Layers size={13} /> Compact
						</button>
					</div>
				</div>

				{/* Плагінні панелі чату (ui:chat-panel). Показуються лише за наявності. */}
				{chatPanels.length > 0 && (
					<div className="cc-chat-panels border-bottom">
						<button
							type="button"
							className="cc-chat-panels-toggle btn btn-sm btn-link text-decoration-none text-muted px-4 py-1"
							onClick={() => setPanelsOpen((v) => !v)}
						>
							{panelsOpen ? "▾" : "▸"} Плагіни ({chatPanels.length})
						</button>
						{panelsOpen && (
							<div className="cc-chat-panels-body px-4 pb-2">
								{chatPanels.map((panel) => (
									<div key={panel.id} className="cc-chat-panel">
										{panel.label && <div className="cc-chat-panel-label small text-muted">{panel.label}</div>}
										{panel.render()}
									</div>
								))}
							</div>
						)}
					</div>
				)}

				<div
					ref={scrollRef}
					onScroll={handleScroll}
				className="flex-grow-1 overflow-auto px-4 py-3"
				style={{ background: "var(--pi-page-bg, #f8f8f8)" }}
			>
				<div style={{ maxWidth: 900, margin: "0 auto" }}>
					{messages.length === 0 && !live.streamingMessage && !live.working && !compaction ? (
						<div className="text-muted text-center mt-5">
							Напишіть перше повідомлення, щоб почати розмову.
						</div>
					) : (
						<ConversationView
							messages={messages}
							toolStatus={toolStatus}
							streamingMessage={live.streamingMessage}
							streamingTextIndex={live.streamingTextIndex}
							streamingThinkingIndex={live.streamingThinkingIndex}
							messageActions={messageActions}
						/>
					)}
					{/* Compaction як tool call: running (спінер) → done (success + summary peek). */}
					{compaction && (
						<div className="cc-ui-msg cc-ui-msg-assistant">
							<ToolCall call={makeCompactCall(compaction)} status={compaction.status}>
								{compaction.summary ? (
									<div className="cc-ui-compaction-summary">{compaction.summary}</div>
								) : undefined}
							</ToolCall>
						</div>
					)}
					{/* Standalone preloader: 3 крапки безперервно від відправки доки не пішов текст/thinking-стрім. */}
					{live.working &&
						live.streamingTextIndex === undefined &&
						live.streamingThinkingIndex === undefined && (
						<div className="cc-ui-msg cc-ui-msg-assistant">
							<span className="cc-ui-streaming-dots" aria-hidden="true">
								<span />
								<span />
								<span />
							</span>
						</div>
					)}
					{error && (
						<div
							className="alert alert-warning mt-3 mb-0 small"
							style={{ maxWidth: 900 }}
							role="alert"
						>
							{error}{" "}
							{error.includes("підключ") && (
								<a href="/settings">→ Налаштування</a>
							)}
						</div>
					)}
				</div>
			</div>

			<div className="border-top p-3 bg-white">
				<form
					onSubmit={handleSubmit}
					className="d-flex gap-2"
					style={{ maxWidth: 900, margin: "0 auto" }}
				>
					<input
						type="text"
						className="form-control"
						placeholder="Напишіть повідомлення…"
						value={input}
						onChange={(e) => setInput(e.target.value)}
						disabled={running}
					/>
					{running ? (
						<button
							type="button"
							className="btn btn-danger d-flex align-items-center gap-1"
							onClick={handleStop}
							title="Зупинити"
						>
							<Square size={14} /> Стоп
						</button>
					) : (
						<button type="submit" className="btn btn-primary" disabled={!input.trim() || catalog.length === 0} title={catalog.length === 0 ? "Підключіть провайдера" : undefined}>
							<Send size={16} />
						</button>
					)}
				</form>
			</div>
		</div>
	);
}

/** Форматування токенів у людський вигляд (k/M). */
function formatTokens(n: number): string {
	if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
	if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
	return String(n);
}

/** Індикатор використання контексту: іконка + токени (без бару). */
function ContextGauge({
	usage,
}: {
	usage: { tokensUsed: number; contextWindow: number; pct: number };
}): React.ReactNode {
	const pct = Math.min(usage.pct, 100);
	return (
		<div className="cc-context-gauge" title={`${usage.tokensUsed} / ${usage.contextWindow} токенів (${pct.toFixed(1)}%)`}>
			<Gauge size={13} className="cc-context-icon" />
			<span className="cc-context-text">
				{formatTokens(usage.tokensUsed)} / {formatTokens(usage.contextWindow)}
			</span>
		</div>
	);
}
