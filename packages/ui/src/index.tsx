/**
 * @coudycode/ui — React UI-двигун для рендерингу агентних взаємодій.
 *
 * Споживає реальні типи з @coudycode/agent-core (AgentMessage, AgentEvent)
 * та @coudycode/ai (content-типи). Без прив'язки до конкретного агента —
 * підходить для підключення runAgentLoop або мок-стріму.
 */

export * from "./components/index.tsx";
export {
	applyEvent,
	initialConversationState,
	type ConversationState,
} from "./stream-accumulator.ts";
