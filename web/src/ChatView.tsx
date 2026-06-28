import { useCallback, useEffect, useRef, useState } from "react";
import { Send, Square } from "lucide-react";
import type { AgentEvent, AgentMessage } from "@coudycode/agent-core";
import {
	ConversationView,
	WorkingIndicator,
	applyEvent,
	initialConversationState,
	type ConversationState,
	type ToolCallStatus,
} from "@coudycode/ui";
import "@coudycode/ui/styles.css";
import { streamChat } from "./chat-stream";

interface ChatViewProps {
	sessionId: string;
}

/** Серверна сесія (GET /api/sessions/:id). */
interface ServerSession {
	id: string;
	name: string | null;
	messages: AgentMessage[];
}

/** Чат із реальним агентом (/api/chat SSE) + історія сесії. */
export default function ChatView({ sessionId }: ChatViewProps): React.ReactNode {
	// Постійна історія сесії (завантажена з бекенду).
	const [committed, setCommitted] = useState<AgentMessage[]>([]);
	const [committedStatus, setCommittedStatus] = useState<Record<string, ToolCallStatus>>({});
	const [title, setTitle] = useState<string>("Чат");
	// Поточний хід (стрімиться).
	const [live, setLive] = useState<ConversationState>(initialConversationState);

	const [input, setInput] = useState("");
	const [running, setRunning] = useState(false);
	const [error, setError] = useState<string | null>(null);

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
			setLive(initialConversationState);
			workingRef.current = initialConversationState;
			setError(null);
			stickRef.current = true;
		} catch {
			/* ignore */
		}
	}, [sessionId]);

	useEffect(() => {
		void loadSession();
	}, [loadSession]);

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
		setLive(initialConversationState);
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
			<div className="border-bottom px-4 py-2 d-flex align-items-center justify-content-between">
				<h6 className="mb-0 text-truncate">{title}</h6>
				{live.working && <WorkingIndicator label="Агент працює" />}
			</div>

			<div
				ref={scrollRef}
				onScroll={handleScroll}
				className="flex-grow-1 overflow-auto px-4 py-3"
				style={{ background: "var(--pi-page-bg, #f8f8f8)" }}
			>
				<div style={{ maxWidth: 900, margin: "0 auto" }}>
					{messages.length === 0 && !live.streamingMessage ? (
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
						/>
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
						<button type="submit" className="btn btn-primary" disabled={!input.trim()}>
							<Send size={16} />
						</button>
					)}
				</form>
			</div>
		</div>
	);
}
