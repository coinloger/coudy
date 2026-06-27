import { useEffect, useRef, useState } from "react";
import { ChevronDown, Square } from "lucide-react";
import {
	ConversationView,
	WorkingIndicator,
	applyEvent,
	initialConversationState,
	type ConversationState,
	type ToolCallStatus,
} from "@coudycode/ui";
import type { AgentEvent, AgentMessage } from "@coudycode/agent-core";
import "@coudycode/ui/styles.css";
import { runMockAgent, type MockSpeed } from "./mock-agent";

const SPEEDS: MockSpeed[] = ["0.5x", "1x", "2x", "instant"];
const DEFAULT_PROMPT = "Допоможи розібратись з проектом і додати фічу";

/** Сторінка /playground — тест UI-двигуна на мок-стрімі агента. */
export default function Playground(): React.ReactNode {
	// Постійна історія розмови (накопичується між промптами).
	const [committed, setCommitted] = useState<AgentMessage[]>([]);
	const [committedStatus, setCommittedStatus] = useState<Record<string, ToolCallStatus>>({});
	// Поточний хід (стрімиться зараз).
	const [live, setLive] = useState<ConversationState>(initialConversationState);

	const [input, setInput] = useState("");
	const [speed, setSpeed] = useState<MockSpeed>("1x");
	const [running, setRunning] = useState(false);

	const workingRef = useRef<ConversationState>(initialConversationState);
	const lastPromptRef = useRef<string>("");
	const scrollRef = useRef<HTMLDivElement>(null);
	const inputRef = useRef<HTMLTextAreaElement>(null);
	const abortRef = useRef<AbortController | null>(null);
	// Smart auto-scroll ("stick to bottom"): тягнемо донизу лише якщо користувач біля низу.
	const stickRef = useRef(true);
	const lastScrollTopRef = useRef(0);
	const programmaticScrollRef = useRef(false);
	const [showScrollBtn, setShowScrollBtn] = useState(false);
	const SCROLL_THRESHOLD = 40;

	// Об'єднаний стан для рендеру: історія + поточний хід + часткове повідомлення.
	const messages: AgentMessage[] = [...committed, ...live.messages];
	const toolStatus: Record<string, ToolCallStatus> = { ...committedStatus, ...live.toolStatus };
	const streamingMessage = live.streamingMessage;

	// Smart auto-scroll: лише якщо користувач біля низу (stick). Програмний скрол
	// позначаємо прапорцем, щоб onScroll не «приклеював» назад під час ручного гортання.
	useEffect(() => {
		if (!stickRef.current) {
			setShowScrollBtn(true);
			return;
		}
		setShowScrollBtn(false);
		const el = scrollRef.current;
		if (el) {
			programmaticScrollRef.current = true;
			el.scrollTo({ top: el.scrollHeight, behavior: "auto" });
		}
	}, [messages, streamingMessage]);

	const handleScroll = (): void => {
		const el = scrollRef.current;
		if (!el) return;
		const top = el.scrollTop;
		const programmatic = programmaticScrollRef.current;
		programmaticScrollRef.current = false;
		// Ручний скрол вгору → негайно відліплюємо (вільний скрол).
		if (!programmatic && top < lastScrollTopRef.current - 1) {
			stickRef.current = false;
		}
		lastScrollTopRef.current = top;
		// Програмний авто-скрол не впливає на sticky.
		if (programmatic) return;
		const atBottom = top + el.clientHeight >= el.scrollHeight - SCROLL_THRESHOLD;
		if (atBottom) {
			stickRef.current = true;
			setShowScrollBtn(false);
		}
	};

	// Auto-grow текстового поля за висотою (max ~160px), далі — внутрішній скрол.
	useEffect(() => {
		const el = inputRef.current;
		if (!el) return;
		el.style.height = "auto";
		el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
	}, [input]);

	const scrollToBottom = (): void => {
		stickRef.current = true;
		programmaticScrollRef.current = true;
		const el = scrollRef.current;
		if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
		setShowScrollBtn(false);
	};

	const onEvent = (event: AgentEvent): void => {
		// Перехоплюємо agent_end: applyEvent замінив би messages на event.messages
		// (у маку — лише user-повідомлення), стерши асистентську відповідь.
		// Натомість дописуємо акумульовані повідомлення цього ходу в історію.
		if (event.type === "agent_end") {
			const turn = workingRef.current;
			setCommitted((prev) => [...prev, ...turn.messages]);
			setCommittedStatus((prev) => ({ ...prev, ...turn.toolStatus }));
			workingRef.current = initialConversationState;
			setLive(initialConversationState);
			return;
		}
		workingRef.current = applyEvent(workingRef.current, event);
		setLive({ ...workingRef.current });
	};

	const startStream = (prompt: string): void => {
		if (!prompt || running) return;
		lastPromptRef.current = prompt;
		setInput("");
		setRunning(true);
		workingRef.current = initialConversationState;
		setLive(initialConversationState);
		const controller = new AbortController();
		abortRef.current = controller;
		runMockAgent(prompt, onEvent, { speed, signal: controller.signal })
			.catch(() => {
				// Переривання (Стоп) або помилка моку — partial фінішиться у finally.
			})
			.finally(() => {
				// На нормальному завершенні workingRef вже порожній (agent_end) — пропустимо.
				// На перериванні — комітимо partial-повідомлення як є у історію.
				const turn = workingRef.current;
				if (turn.streamingMessage || turn.messages.length > 0) {
					const msgs = [...turn.messages];
					if (turn.streamingMessage) msgs.push(turn.streamingMessage);
					const statuses = { ...turn.toolStatus };
					for (const k of Object.keys(statuses)) if (statuses[k] === "running") statuses[k] = "done";
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

	const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
		if (e.key === "Enter" && !e.shiftKey) {
			e.preventDefault();
			startStream(input.trim() || DEFAULT_PROMPT);
		}
	};

	const handleSend = (e: React.FormEvent): void => {
		e.preventDefault();
		startStream(input.trim() || DEFAULT_PROMPT);
	};

	const handleReplay = (): void => {
		startStream(lastPromptRef.current || DEFAULT_PROMPT);
	};

	const handleClear = (): void => {
		setCommitted([]);
		setCommittedStatus({});
		workingRef.current = initialConversationState;
		setLive(initialConversationState);
		lastPromptRef.current = "";
	};

	return (
		<div className="d-flex flex-column h-100">
			<div className="border-bottom px-4 py-2 d-flex align-items-center justify-content-between gap-3 flex-wrap">
				<div>
					<strong>UI Playground</strong>{" "}
					<span className="text-muted small">— тест рендерингу @coudycode/ui на мок-стрімі</span>
				</div>
				<div className="d-flex align-items-center gap-2">
					{live.working && <WorkingIndicator label="Агент працює" />}
					<div className="d-flex align-items-center gap-1">
						<span className="text-muted small me-1">Темп:</span>
						<select
							className="form-select form-select-sm"
							style={{ width: "auto" }}
							value={speed}
							onChange={(e) => setSpeed(e.target.value as MockSpeed)}
							disabled={running}
						>
							{SPEEDS.map((s) => (
								<option key={s} value={s}>
									{s === "instant" ? "миттєво" : s}
								</option>
							))}
						</select>
					</div>
					<button
						type="button"
						className="btn btn-outline-secondary btn-sm"
						onClick={handleReplay}
						disabled={running || !lastPromptRef.current}
						title="Переграти останній промпт (дописати ще одну відповідь)"
					>
						↻ Replay
					</button>
					<button
						type="button"
						className="btn btn-outline-danger btn-sm"
						onClick={handleClear}
						disabled={running || messages.length === 0}
						title="Очистити чат"
					>
						Очистити
					</button>
				</div>
			</div>

			<div
				ref={scrollRef}
				onScroll={handleScroll}
				className="flex-grow-1 overflow-auto px-4 py-3 bg-light"
				style={{ position: "relative" }}
			>
				<div style={{ maxWidth: 900, margin: "0 auto" }}>
					{messages.length === 0 && !streamingMessage ? (
						<div className="text-muted text-center mt-5">
							Відправте промпт нижче, щоб запустити мок-стрім агента (thinking → текст+код → tool read/bash/edit+diff).
							Розмова накопичується — відправляйте кілька промптів підряд.
						</div>
					) : (
						<ConversationView
							messages={messages}
							toolStatus={toolStatus}
							streamingMessage={streamingMessage}
							streamingTextIndex={live.streamingTextIndex}
							streamingThinkingIndex={live.streamingThinkingIndex}
						/>
					)}
				</div>
				{showScrollBtn && (
					<button
						type="button"
						onClick={scrollToBottom}
						className="cc-ui-scroll-btn"
						title="До низу"
					>
						<ChevronDown size={18} />
					</button>
				)}
			</div>

			<div className="border-top p-3 bg-white">
				<form onSubmit={handleSend} className="d-flex gap-2 align-items-end" style={{ maxWidth: 900, margin: "0 auto" }}>
					<textarea
						ref={inputRef}
						className="form-control"
						placeholder="Введіть промпт…"
						value={input}
						onChange={(e) => setInput(e.target.value)}
						onKeyDown={handleKeyDown}
						disabled={running}
						rows={1}
						autoFocus
						title="Enter — відправка, Shift+Enter — новий рядок"
						style={{ resize: "none", maxHeight: 160, overflowY: "auto" }}
					/>
					{running ? (
						<button
							type="button"
							className="btn btn-danger d-flex align-items-center gap-1"
							onClick={handleStop}
							title="Зупинити генерацію"
						>
							<Square size={14} /> Стоп
						</button>
					) : (
						<button type="submit" className="btn btn-primary">
							Надіслати
						</button>
					)}
				</form>
			</div>
		</div>
	);
}
