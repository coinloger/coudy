import { useCallback, useEffect, useRef, useState } from "react";
import { Send, Square, Gauge } from "lucide-react";
import type { AgentEvent, AgentMessage } from "@coudycode/agent-core";
import {
	ConversationView,
	applyEvent,
	initialConversationState,
	type ConversationState,
	type ToolCallStatus,
} from "@coudycode/ui";
import "@coudycode/ui/styles.css";
import { streamChat } from "./chat-stream";
import { ModelSelector, type CurrentModel, type ProviderGroup } from "./ModelSelector";

export interface PluginChatCanvasProps {
	/** Імʼя плагіна-власника сесії. */
	pluginName: string;
	/** Plugin-scoped id сесії (який декларовано через declareSession). */
	pluginSessionId: string;
	/** Заголовок чату (необовʼязково; дефолт — title сесії). */
	title?: string;
	/**
	 * Висота canvas (напр. 600 або "500px"). Не задано → 100% від батька (backwards-compat).
	 * Взаємодіє з style/className (style.height пріоритетніший).
	 */
	height?: number | string;
	/** Inline-стилі root-контейнера (height тут пріоритетніший за prop). */
	style?: React.CSSProperties;
	/** Додаткові класи root-контейнера. */
	className?: string;
}

/** Plugin-сесія з GET /api/plugins/:plugin/sessions/:pluginSessionId (= SessionFull). */
interface PluginSessionResponse {
	id: string;
	name: string | null;
	model: CurrentModel | null;
	contextUsage: { tokensUsed: number; contextWindow: number; pct: number } | null;
	messages: AgentMessage[];
}

/**
 * Reusable chat-canvas для плагінів: самодостатній чат, що вказує на plugin-сесію.
 * Завантажує реальну сесію за {pluginName, pluginSessionId}, відправляє повідомлення
 * через /api/chat (бекенд резолвить ownership → ізольований конфіг плагіна:
 * тулзи/промпт/contextProvider-фід). Реюз ConversationView + chat-stream + applyEvent.
 *
 * Експонується глобально як window.coudy.PluginChatCanvas для плагінів (TSX).
 */
export default function PluginChatCanvas({
	pluginName,
	pluginSessionId,
	title: titleProp,
	height,
	style,
	className,
}: PluginChatCanvasProps): React.ReactNode {
	const sessionUrl = `/api/plugins/${encodeURIComponent(pluginName)}/sessions/${encodeURIComponent(pluginSessionId)}`;
	// Гнучкий розмір: height prop / style / className ззовні (дефолт h-100 = 100% батька).
	const hasExplicitSize = height !== undefined || (style && (style.height !== undefined || style.maxHeight !== undefined));
	const rootClassName = hasExplicitSize
		? `d-flex flex-column ${className ?? ""}`.trim()
		: `d-flex flex-column h-100 ${className ?? ""}`.trim();
	const rootStyle: React.CSSProperties = {
		...(height !== undefined ? { height: typeof height === "number" ? `${height}px` : height } : {}),
		...style,
	};

	const [realSessionId, setRealSessionId] = useState<string | null>(null);
	const [committed, setCommitted] = useState<AgentMessage[]>([]);
	const [committedStatus, setCommittedStatus] = useState<Record<string, ToolCallStatus>>({});
	const [title, setTitle] = useState<string>(titleProp ?? "Чат плагіна");
	const [contextUsage, setContextUsage] = useState<{
		tokensUsed: number;
		contextWindow: number;
		pct: number;
	} | null>(null);
	const [live, setLive] = useState<ConversationState>(initialConversationState);

	const [input, setInput] = useState("");
	const [running, setRunning] = useState(false);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	const [currentModel, setCurrentModel] = useState<CurrentModel | null>(null);
	const [catalog, setCatalog] = useState<ProviderGroup[]>([]);

	const workingRef = useRef<ConversationState>(initialConversationState);
	const abortRef = useRef<AbortController | null>(null);
	const scrollRef = useRef<HTMLDivElement>(null);
	const stickRef = useRef(true);

	const messages: AgentMessage[] = [...committed, ...live.messages];
	const toolStatus: Record<string, ToolCallStatus> = { ...committedStatus, ...live.toolStatus };

	/** Завантажити plugin-сесію (realSessionUuid + messages + model). */
	const loadSession = useCallback(async (): Promise<void> => {
		try {
			const r = await fetch(sessionUrl);
			if (!r.ok) {
				setError(`Не вдалося завантажити сесію плагіна (HTTP ${r.status})`);
				setLoading(false);
				return;
			}
			const s = (await r.json()) as PluginSessionResponse;
			setRealSessionId(s.id);
			setCommitted(s.messages ?? []);
			setCommittedStatus({});
			setTitle(titleProp ?? s.name ?? "Чат плагіна");
			setContextUsage(s.contextUsage ?? null);
			setCurrentModel(s.model ?? null);
			setLive(initialConversationState);
			workingRef.current = initialConversationState;
			setError(null);
			stickRef.current = true;
		} catch {
			setError("Не вдалося завантажити сесію плагіна");
		} finally {
			setLoading(false);
		}
	}, [sessionUrl, titleProp]);

	useEffect(() => {
		setLoading(true);
		void loadSession();
	}, [loadSession]);

	// Завантажити каталог підключених провайдерів + автообрати першу модель якщо в сесії нема.
	useEffect(() => {
		let cancelled = false;
		void fetch("/api/models")
			.then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
			.then((data: { providers: ProviderGroup[] }) => data.providers ?? [])
			.catch(() => [] as ProviderGroup[])
			.then((providers) => {
				if (cancelled) return;
				setCatalog(providers);
			});
		return () => {
			cancelled = true;
		};
	}, []);

	// Автообрати першу доступну модель для plugin-сесії, якщо її ще нема.
	useEffect(() => {
		if (!realSessionId || currentModel || catalog.length === 0) return;
		const first = catalog[0]?.models[0];
		if (!first) return;
		void fetch(`/api/sessions/${encodeURIComponent(realSessionId)}/model`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ provider: first.provider, modelId: first.id }),
		})
			.then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
			.then((s: { model?: CurrentModel | null }) => {
				setCurrentModel(s.model ?? { provider: first.provider, modelId: first.id, label: first.label });
			})
			.catch(() => undefined);
	}, [realSessionId, currentModel, catalog]);

	/** Обрати модель → POST /api/sessions/:id/model. */
	const handleSelectModel = (provider: string, modelId: string): void => {
		if (!realSessionId) return;
		void fetch(`/api/sessions/${encodeURIComponent(realSessionId)}/model`, {
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

	/** Оновити метадані сесії (contextUsage) після відповіді. */
	const refreshMeta = useCallback(async (): Promise<void> => {
		if (!realSessionId) return;
		try {
			const r = await fetch(sessionUrl);
			if (!r.ok) return;
			const s = (await r.json()) as PluginSessionResponse;
			setContextUsage(s.contextUsage ?? null);
		} catch {
			/* ignore */
		}
	}, [realSessionId, sessionUrl]);

	// Авто-скрол, якщо користувач біля низу.
	useEffect(() => {
		const el = scrollRef.current;
		if (el && stickRef.current) {
			el.scrollTo({ top: el.scrollHeight, behavior: "auto" });
		}
	}, [messages, live.streamingMessage]);

	const onEvent = (event: AgentEvent): void => {
		if (event.type === "agent_end") {
			const turn = workingRef.current;
			setCommitted((prev) => [...prev, ...turn.messages]);
			setCommittedStatus((prev) => ({ ...prev, ...turn.toolStatus }));
			workingRef.current = initialConversationState;
			setLive(initialConversationState);
			void refreshMeta();
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
		if (!message || running || !realSessionId) return;
		setError(null);
		setInput("");
		setRunning(true);
		workingRef.current = initialConversationState;
		setLive({ ...initialConversationState, working: true });
		stickRef.current = true;
		const controller = new AbortController();
		abortRef.current = controller;
		streamChat({ sessionId: realSessionId, message, signal: controller.signal }, onEvent)
			.catch(() => {
				/* переривання або помилка мережі */
			})
			.finally(() => {
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

	if (loading) {
		return (
			<div className={rootClassName} style={rootStyle}>
				<div className="flex-grow-1 d-flex align-items-center justify-content-center text-muted">
					Завантаження сесії…
				</div>
			</div>
		);
	}

	if (!realSessionId) {
		return (
			<div className={rootClassName} style={rootStyle}>
				<div className="flex-grow-1 d-flex align-items-center justify-content-center text-muted">
					Сесію плагіна не знайдено. Переконайтесь, що плагін активний (declareSession).
				</div>
			</div>
		);
	}

	return (
		<div className={rootClassName} style={rootStyle}>
			<div className="border-bottom px-4 py-2 d-flex align-items-center justify-content-between gap-2">
				<h6 className="mb-0 text-truncate">{title}</h6>
				<div className="d-flex align-items-center gap-2">
					{contextUsage && <ContextGauge usage={contextUsage} />}
					{currentModel && (
						<ModelSelector current={currentModel} catalog={catalog} onSelect={handleSelectModel} />
					)}
				</div>
			</div>

			<div
				ref={scrollRef}
				onScroll={handleScroll}
				className="flex-grow-1 overflow-auto px-4 py-3"
				style={{ background: "var(--pi-page-bg, #f8f8f8)" }}
			>
				<div style={{ maxWidth: 900, margin: "0 auto" }}>
					{messages.length === 0 && !live.streamingMessage && !live.working ? (
						<div className="text-muted text-center mt-5">
							Напишіть повідомлення — агент плагіна відповість у цій ізольованій сесії.
						</div>
					) : (
						<ConversationView
							messages={messages}
							toolStatus={toolStatus}
							streamingMessage={live.streamingMessage}
							streamingTextIndex={live.streamingTextIndex}
							streamingThinkingIndex={live.streamingThinkingIndex}
						/>
					)}
					{/* Standalone preloader: 3 крапки доки не пішов текст/thinking-стрім. */}
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
						<div className="alert alert-warning mt-3 mb-0 small" role="alert">
							{error}
						</div>
					)}
				</div>
			</div>

			<div className="border-top p-3 bg-white">
				<form onSubmit={handleSubmit} className="d-flex gap-2" style={{ maxWidth: 900, margin: "0 auto" }}>
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
						<button
							type="submit"
							className="btn btn-primary"
							disabled={!input.trim() || catalog.length === 0}
							title={catalog.length === 0 ? "Підключіть провайдера" : undefined}
						>
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

/** Індикатор використання контексту: іконка + токени. */
function ContextGauge({
	usage,
}: {
	usage: { tokensUsed: number; contextWindow: number; pct: number };
}): React.ReactNode {
	const pct = Math.min(usage.pct, 100);
	return (
		<div
			className="cc-context-gauge"
			title={`${usage.tokensUsed} / ${usage.contextWindow} токенів (${pct.toFixed(1)}%)`}
		>
			<Gauge size={13} className="cc-context-icon" />
			<span className="cc-context-text">
				{formatTokens(usage.tokensUsed)} / {formatTokens(usage.contextWindow)}
			</span>
		</div>
	);
}
