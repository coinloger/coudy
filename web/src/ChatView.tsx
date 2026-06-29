import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Paperclip, ArrowUp, Square, Gauge, Layers, X } from "lucide-react";
import type { AgentMessage } from "@coudycode/agent-core";
import type { ImageContent, ToolCall as ToolCallContent } from "@coudycode/ai";
import {
	ConversationView,
	ToolCall,
	WorkingIndicator,
	extractMessageText,
	extractMessageImages,
	type ToolCallStatus,
} from "@coudycode/ui";
import "@coudycode/ui/styles.css";
import { ModelSelector, type CurrentModel, type ProviderGroup } from "./ModelSelector";
import { ProcessBar } from "./ProcessBar";
import { PromptSelector, type PromptTemplateEntry } from "./PromptSelector";
import { useSessionRunner } from "./useSessionRunner";
import { sessionRunner } from "./session-runner";
import { filesToImages, imagesFromPaste, isBlockingOverlayOpen, isFocusInEditable } from "./composer-utils";
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
	// Поточний хід (стрімиться) — з SessionRunner (фоновий агент, переживає навігацію).
	const { working: live, running, error: runError, start: runnerStart, abort: runnerAbort, startTime } = useSessionRunner(sessionId);
	const [input, setInput] = useState("");
	const [images, setImages] = useState<ImageContent[]>([]);
	const [compaction, setCompaction] = useState<CompactionState | null>(null);
	const [compacting, setCompacting] = useState(false);
	const [panelsOpen, setPanelsOpen] = useState(true);

	// Вибір моделі (поточна + каталог підключених провайдерів).
	const [currentModel, setCurrentModel] = useState<CurrentModel | null>(null);
	const [catalog, setCatalog] = useState<ProviderGroup[]>([]);
	// Вибір шаблону системного промпту (per-session).
	const [currentPrompt, setCurrentPrompt] = useState<{ id: string; name: string } | null>(null);
	const [promptTemplates, setPromptTemplates] = useState<PromptTemplateEntry[]>([]);

	const scrollRef = useRef<HTMLDivElement>(null);
	const stickRef = useRef(true);
	const textareaRef = useRef<HTMLTextAreaElement>(null);
	const fileInputRef = useRef<HTMLInputElement>(null);

	const messages: AgentMessage[] = [...committed, ...live.messages];
	const toolStatus: Record<string, ToolCallStatus> = { ...committedStatus, ...live.toolStatus };
	const error = runError;

	// Accumulated ↓input/↑output-токени по assistant-повідомленнях поточного ходу.
	const usage = sumUsage(live.messages, live.streamingMessage);

	// Тик раз/сек для оновлення elapsed-індикатора (лише коли агент працює).
	const [, setTick] = useState(0);
	useEffect(() => {
		if (!live.working) return;
		const id = setInterval(() => setTick((t) => t + 1), 1000);
		return () => clearInterval(id);
	}, [live.working]);

	const elapsedMs = startTime ? Date.now() - startTime : undefined;

	// Built-in hover-дії на повідомленнях: copy (з фідбеком), time (readonly), retry (user-only).
	const [copiedKey, setCopiedKey] = useState<string | null>(null);
	const keyFor = (m: AgentMessage): string => `${m.role}:${m.timestamp}`;
	const builtInActions = useMemo<MessageAction[]>(() => {
		return [
			{
				id: "copy",
				label: (m: AgentMessage) => (copiedKey === keyFor(m) ? "Скопійовано" : "Копіювати"),
				icon: "Copy",
				onClick: (m: AgentMessage) => {
					void navigator.clipboard
						.writeText(extractMessageText(m))
						.then(() => {
							setCopiedKey(keyFor(m));
							setTimeout(
								() => setCopiedKey((cur) => (cur === keyFor(m) ? null : cur)),
								1500,
							);
						})
						.catch(() => undefined);
				},
			},
			{
				id: "retry",
				label: "Повторити",
				icon: "retry",
				show: (m: AgentMessage) => m.role === "user",
				onClick: (m: AgentMessage) => {
					if (running) return;
					const text = extractMessageText(m);
					const imgs = extractMessageImages(m);
					if (!text && imgs.length === 0) return;
					runnerStart(text, imgs.length ? imgs : undefined);
				},
			},
			{
				id: "time",
				label: (m: AgentMessage) =>
					new Date(m.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
				icon: "Clock",
				display: true,
			},
		];
	}, [copiedKey, running, runnerStart]);

	// Мердж: built-in actions спереду, плагінні — ззаду (без дублів за id).
	const combinedActions = useMemo<MessageAction[]>(() => {
		const seen = new Set(builtInActions.map((a) => a.id));
		const merged = [...builtInActions];
		for (const a of messageActions) {
			if (!seen.has(a.id)) {
				seen.add(a.id);
				merged.push(a);
			}
		}
		return merged;
	}, [builtInActions, messageActions]);


	// Завантажити історію сесії при зміні sessionId.
	const loadSession = useCallback(async () => {
		try {
			const r = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}`);
			if (!r.ok) return;
			const s = (await r.json()) as ServerSession;
			// Якщо зараз стрімиться фоновий агент — НЕ перезаписувати committed його повідомленнями
			// (вони вже в live через SessionRunner); оновити лише метадані.
			if (!sessionRunner.isRunning(sessionId)) {
				setCommitted(s.messages ?? []);
				setCommittedStatus({});
			}
			setTitle(s.name ?? "Чат");
			setCurrentModel(s.model ?? null);
			setContextUsage(s.contextUsage ?? null);
			setCurrentPrompt(s.promptTemplate ?? null);
			setCompaction(null);
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

	// Автофокус поля вводу при маунті та зміні sessionId.
	useEffect(() => {
		textareaRef.current?.focus();
	}, [sessionId]);

	// Глобальний перехоплювач клавіш: друкований символ поза полем вводу →
	// фокус textarea + вставити символ. НЕ ламає ⌘K/модалки/шорткати.
	useEffect(() => {
		const onKey = (e: KeyboardEvent): void => {
			// Лише друковані символи без модифікаторів.
			if (e.key.length !== 1 || e.ctrlKey || e.metaKey || e.altKey) return;
			if (isBlockingOverlayOpen()) return;
			if (isFocusInEditable(document.activeElement)) return;
			const ta = textareaRef.current;
			if (!ta || ta.disabled) return;
			e.preventDefault();
			ta.focus();
			ta.setRangeText(e.key, ta.selectionStart, ta.selectionEnd, "end");
		};
		document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
	}, []);

	// Авто-назва чату: session:title від бекенду → оновити локальний title.
	useEffect(() => {
		return sessionRunner.subscribe(sessionId, (ev) => {
			if (ev.type === "title") setTitle(ev.title);
		});
	}, [sessionId]);

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

	// При завершенні фонового агенту (running true→false) — підтягнути персистовані повідомлення.
	const prevRunning = useRef(false);
	useEffect(() => {
		if (prevRunning.current && !running) {
			// Фоновий агент завершився (або зупинився): підтягнути персистовані повідомлення,
			// потім скинути live-стан SessionRunner (щоб уникнути дублю з committed).
			void loadSession().then(() => sessionRunner.clear(sessionId));
			void refreshSessionMeta();
		}
		prevRunning.current = running;
	}, [running, loadSession, refreshSessionMeta, sessionId]);

	// session_compact / compaction_start (від бекенду всередині чат-стріму) не мають окремого хендлера
	// тепер — але авто-compact вже стрімиться через той самий SSE, і SessionRunner його застосовує.
	// Ручна компактація окремим ендпоінтом — див. handleCompact нижче.

	const startStream = (message: string, imgs: ImageContent[]): void => {
		if (running || (!message && imgs.length === 0)) return;
		setInput("");
		setImages([]);
		stickRef.current = true;
		runnerStart(message, imgs.length ? imgs : undefined);
	};

	const handleStop = (): void => {
		runnerAbort();
	};

	/** Ручна компактація: POST /api/sessions/:id/compact (SSE) → оновити сесію. */
	const handleCompact = (): void => {
		if (running || compacting || compaction) return;
		setCompaction({ status: "running" });
		setCompacting(true);
		stickRef.current = true;
		const controller = new AbortController();
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
				setCompacting(false);
				setCompaction((prev) => (prev?.status === "done" ? prev : null));
			});
	};

	const handleSubmit = (e?: React.FormEvent): void => {
		e?.preventDefault();
		const message = input.trim();
		if (!message && images.length === 0) return;
		startStream(message, images);
	};

	/** Enter = відправити, Shift+Enter = новий рядок. */
	const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
		if (e.key === "Enter" && !e.shiftKey) {
			e.preventDefault();
		handleSubmit();
		}
	};

	/** Авто-зростання textarea (rows=1, кроп ~200px). */
	const handleTextareaInput = (e: React.ChangeEvent<HTMLTextAreaElement>): void => {
		setInput(e.target.value);
		const el = textareaRef.current;
		if (el) {
			el.style.height = "auto";
			el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
		}
	};

	/** Обрати файли → конвертувати у base64 ImageContent → додати. */
	const handleAttach = (e: React.ChangeEvent<HTMLInputElement>): void => {
		const files = Array.from(e.target.files ?? []);
		filesToImages(files, (imgs) => setImages((prev) => [...prev, ...imgs]));
		// Скинути input щоб можна було обрати той самий файл повторно.
		if (fileInputRef.current) fileInputRef.current.value = "";
	};

	/** Ctrl+V зображень з буфера → прикріпити (заборонити paste-текст для файлів). */
	const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>): void => {
		const files = imagesFromPaste(e);
		if (files.length === 0) return;
		e.preventDefault();
		filesToImages(files, (imgs) => setImages((prev) => [...prev, ...imgs]));
	};

	const removeImage = (index: number): void => {
		setImages((prev) => prev.filter((_, i) => i !== index));
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
							messageActions={combinedActions}
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
					{/* Standalone індикатор роботи (braille-спінер + elapsed + ↓↑токени) доки не пішов текст/thinking-стрім. */}
					{live.working &&
						live.streamingTextIndex === undefined &&
						live.streamingThinkingIndex === undefined && (
						<div className="cc-ui-msg cc-ui-msg-assistant">
							<WorkingIndicator
								elapsedMs={elapsedMs}
								inputTokens={usage.input}
								outputTokens={usage.output}
							/>
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

			<div className="cc-composer">
				<div className="cc-composer-inner">
					<ProcessBar />
					<div className="cc-input-card">
						{images.length > 0 && (
							<div className="cc-attach-preview">
								{images.map((img, i) => (
									<div key={i} className="cc-attach-thumb">
										<img src={`data:${img.mimeType};base64,${img.data}`} alt="attachment" />
										<button type="button" className="cc-attach-remove" onClick={() => removeImage(i)} title="Прибрати">
											<X size={11} />
										</button>
									</div>
								))}
							</div>
						)}
						<form className="cc-input-row" onSubmit={handleSubmit}>
							<input
								ref={fileInputRef}
								type="file"
								accept="image/*"
								multiple
								style={{ display: "none" }}
								onChange={handleAttach}
							/>
							<button
								type="button"
								className="cc-input-btn cc-input-attach"
								onClick={() => fileInputRef.current?.click()}
								disabled={running}
								title="Прикріпити зображення"
							>
								<Paperclip size={17} />
							</button>
							<textarea
								ref={textareaRef}
								className="cc-input-textarea"
								rows={1}
								placeholder="Напишіть повідомлення…"
								value={input}
								onChange={handleTextareaInput}
								onKeyDown={handleKeyDown}
								onPaste={handlePaste}
								disabled={running}
							/>
							{running ? (
								<button
									type="button"
									className="cc-input-btn cc-input-stop"
									onClick={handleStop}
									title="Зупинити"
								>
									<Square size={15} />
								</button>
							) : (
								<button
									type="submit"
									className="cc-input-btn cc-input-send"
									disabled={(!input.trim() && images.length === 0) || catalog.length === 0}
									title={catalog.length === 0 ? "Підключіть провайдера" : "Надіслати"}
								>
									<ArrowUp size={17} />
								</button>
							)}
						</form>
					</div>
				</div>
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

/**
 * Accumulated input/output-токени по assistant-повідомленнях ходу
 * (вкл. streamingMessage якщо воно має usage).
 */
function sumUsage(messages: AgentMessage[], streaming?: AgentMessage): { input: number; output: number } {
	let input = 0;
	let output = 0;
	const acc = (msg: AgentMessage): void => {
		if (msg.role !== "assistant") return;
		const usage = (msg as { usage?: { input?: number; output?: number } }).usage;
		if (usage && typeof usage.input === "number") input += usage.input;
		if (usage && typeof usage.output === "number") output += usage.output;
	};
	for (const m of messages) acc(m);
	if (streaming) acc(streaming);
	return { input, output };
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
