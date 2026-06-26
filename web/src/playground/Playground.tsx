import { useEffect, useRef, useState } from "react";
import {
	ConversationView,
	WorkingIndicator,
	applyEvent,
	initialConversationState,
	type ConversationState,
} from "@coudycode/ui";
import "@coudycode/ui/styles.css";
import { runMockAgent, type MockSpeed } from "./mock-agent";

const SPEEDS: MockSpeed[] = ["0.5x", "1x", "2x", "instant"];

const DEFAULT_PROMPT = "Покажи демо інструментів";

/** Сторінка /playground — тест UI-двигуна на мок-стрімі агента. */
export default function Playground(): React.ReactNode {
	const [state, setState] = useState<ConversationState>(initialConversationState);
	const [input, setInput] = useState("");
	const [speed, setSpeed] = useState<MockSpeed>("1x");
	const [running, setRunning] = useState(false);
	const scrollRef = useRef<HTMLDivElement>(null);
	const lastPromptRef = useRef<string>("");

	// Авто-скрол до низу по мірі появи контенту.
	useEffect(() => {
		const el = scrollRef.current;
		if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
	}, [state]);

	const startStream = (prompt: string): void => {
		if (!prompt || running) return;
		lastPromptRef.current = prompt;
		setInput("");
		setRunning(true);
		setState(initialConversationState);
		void runMockAgent(
			prompt,
			(event) => {
				setState((prev) => applyEvent(prev, event));
			},
			{ speed },
		).finally(() => setRunning(false));
	};

	const handleSend = (e: React.FormEvent): void => {
		e.preventDefault();
		startStream(input.trim() || DEFAULT_PROMPT);
	};

	const handleReplay = (): void => {
		startStream(lastPromptRef.current || DEFAULT_PROMPT);
	};

	return (
		<div className="d-flex flex-column h-100">
			<div className="border-bottom px-4 py-2 d-flex align-items-center justify-content-between gap-3 flex-wrap">
				<div>
					<strong>UI Playground</strong>{" "}
					<span className="text-muted small">— тест рендерингу @coudycode/ui на мок-стрімі</span>
				</div>
				<div className="d-flex align-items-center gap-2">
					{state.working && <WorkingIndicator label="Агент працює" />}
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
						title="Перезапустити стрім спочатку"
					>
						↻ Replay
					</button>
				</div>
			</div>

			<div ref={scrollRef} className="flex-grow-1 overflow-auto px-4 py-3 bg-light">
				<div style={{ maxWidth: 900, margin: "0 auto" }}>
					{state.messages.length === 0 && !state.streamingMessage ? (
						<div className="text-muted text-center mt-5">
							Відправте промпт нижче, щоб запустити мок-стрім агента (thinking → текст+код → tool read/bash/edit+diff).
						</div>
					) : (
						<ConversationView
							messages={state.messages}
							toolStatus={state.toolStatus}
							streamingMessage={state.streamingMessage}
							streamingTextIndex={state.streamingTextIndex}
							streamingThinkingIndex={state.streamingThinkingIndex}
						/>
					)}
				</div>
			</div>

			<div className="border-top p-3 bg-white">
				<form onSubmit={handleSend} className="d-flex gap-2" style={{ maxWidth: 900, margin: "0 auto" }}>
					<input
						type="text"
						className="form-control"
						placeholder="Введіть промпт (напр. «покажи демо інструментів»)…"
						value={input}
						onChange={(e) => setInput(e.target.value)}
						disabled={running}
					/>
					<button type="submit" className="btn btn-primary" disabled={running}>
						{state.messages.length > 0 || state.streamingMessage ? " Restart" : " Запустити"}
					</button>
				</form>
			</div>
		</div>
	);
}
