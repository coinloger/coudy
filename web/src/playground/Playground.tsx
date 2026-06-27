import { useEffect, useRef, useState } from "react";
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

	// Об'єднаний стан для рендеру: історія + поточний хід + часткове повідомлення.
	const messages: AgentMessage[] = [...committed, ...live.messages];
	const toolStatus: Record<string, ToolCallStatus> = { ...committedStatus, ...live.toolStatus };
	const streamingMessage = live.streamingMessage;

	// Авто-скрол до низу по мірі появи контенту.
	useEffect(() => {
		const el = scrollRef.current;
		if (el) el.scrollTo({ top: el.scrollHeight, behavior: "auto" });
	}, [messages, streamingMessage]);

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
		void runMockAgent(prompt, onEvent, { speed }).finally(() => setRunning(false));
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

			<div ref={scrollRef} className="flex-grow-1 overflow-auto px-4 py-3 bg-light">
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
			</div>

			<div className="border-top p-3 bg-white">
				<form onSubmit={handleSend} className="d-flex gap-2" style={{ maxWidth: 900, margin: "0 auto" }}>
					<input
						type="text"
						className="form-control"
						placeholder="Введіть промпт…"
						value={input}
						onChange={(e) => setInput(e.target.value)}
						disabled={running}
					/>
					<button type="submit" className="btn btn-primary" disabled={running}>
						Надіслати
					</button>
				</form>
			</div>
		</div>
	);
}
