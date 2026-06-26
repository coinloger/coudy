import { useState } from "react";
import { ConversationView, applyEvent, initialConversationState, type ConversationState } from "@coudycode/ui";
import "@coudycode/ui/styles.css";
import { runMockAgent } from "./mock-agent";

/** Сторінка /playground — тест UI-двигуна на мок-стрімі агента. */
export default function Playground(): React.ReactNode {
	const [state, setState] = useState<ConversationState>(initialConversationState);
	const [input, setInput] = useState("");
	const [running, setRunning] = useState(false);

	const handleSend = (e: React.FormEvent): void => {
		e.preventDefault();
		const prompt = input.trim();
		if (!prompt || running) return;
		setInput("");
		setRunning(true);
		setState(initialConversationState);
		void runMockAgent(prompt, (event) => {
			setState((prev) => applyEvent(prev, event));
		}).finally(() => setRunning(false));
	};

	return (
		<div className="d-flex flex-column h-100">
			<div className="border-bottom px-4 py-2 d-flex align-items-center justify-content-between">
				<div>
					<strong>UI Playground</strong>{" "}
					<span className="text-muted small">— тест рендерингу @coudycode/ui на мок-стрімі</span>
				</div>
				{running && <span className="badge bg-warning text-dark">стрімиться…</span>}
			</div>

			<div className="flex-grow-1 overflow-auto px-4 py-3 bg-light">
				<div style={{ maxWidth: 900, margin: "0 auto" }}>
					{state.messages.length === 0 && !state.streamingMessage ? (
						<div className="text-muted text-center mt-5">
							Відправте промпт нижче, щоб запустити мок-стрім агента (текст + код + read/bash/edit + diff + thinking).
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
					<button type="submit" className="btn btn-primary" disabled={running || !input.trim()}>
						Запустити
					</button>
				</form>
			</div>
		</div>
	);
}
