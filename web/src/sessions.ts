import { useCallback, useEffect, useState } from "react";

/** Серверний summary сесії (GET /api/sessions). */
export interface SessionSummary {
  id: string;
  name: string | null;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

/** Повна сесія з сервера (GET /api/sessions/:id). */
export interface ServerSession extends SessionSummary {
  messages: unknown[];
}

/** Повідомлення чату (клієнтське представлення для ChatView). */
export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: number;
}

/** Сесія чату (клієнтське представлення: title + messages для UI). */
export interface ChatSession {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
}

const ACTIVE_KEY = "coudycode:active-session";

function loadActiveId(): string | null {
  try {
    return localStorage.getItem(ACTIVE_KEY);
  } catch {
    return null;
  }
}

function saveActiveId(id: string | null): void {
  try {
    if (id) localStorage.setItem(ACTIVE_KEY, id);
    else localStorage.removeItem(ACTIVE_KEY);
  } catch {
    /* ignore */
  }
}

/** Витягти текст з AgentMessage (user — рядок; assistant — масив контенту). */
function messageText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((c) =>
        c && typeof c === "object" && "text" in c && typeof (c as { text?: unknown }).text === "string"
          ? (c as { text: string }).text
          : "",
      )
      .join("");
  }
  return "";
}

/** Привести серверну сесію до клієнтського ChatSession. */
function toChatSession(s: ServerSession): ChatSession {
  const messages: ChatMessage[] = (s.messages ?? [])
    .filter((m): m is { role?: string; content?: unknown; timestamp?: number } => typeof m === "object" && m !== null)
    .map((m, i) => ({
      id: `${s.id}-${i}`,
      role: m.role === "user" ? "user" : "assistant",
      content: messageText(m.content),
      createdAt: typeof m.timestamp === "number" ? m.timestamp : Date.parse(s.createdAt) || Date.now(),
    }));
  return {
    id: s.id,
    title: s.name ?? "Новий чат",
    messages,
    createdAt: Date.parse(s.createdAt) || Date.now(),
    updatedAt: Date.parse(s.updatedAt) || Date.now(),
  };
}

function toSummaryItem(s: SessionSummary): { id: string; title: string } {
  return { id: s.id, title: s.name ?? "Новий чат" };
}

/**
 * Сесії чату — серверні (agent-core JSONL через /api/sessions).
 * localStorage зберігає лише UI-стейт (activeSessionId).
 */
export function useSessions() {
  const [summaries, setSummaries] = useState<SessionSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(() => loadActiveId());
  const [activeMessages, setActiveMessages] = useState<ChatMessage[]>([]);
  const [loadingActive, setLoadingActive] = useState(false);

  // Завантажити список сесій.
  const refresh = useCallback(async (): Promise<void> => {
    try {
      const r = await fetch("/api/sessions");
      if (!r.ok) return;
      const data = (await r.json()) as { sessions: SessionSummary[] };
      setSummaries(data.sessions ?? []);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    saveActiveId(activeId);
  }, [activeId]);

  // Завантажити повідомлення активної сесії (GET /api/sessions/:id).
  useEffect(() => {
    if (!activeId) {
      setActiveMessages([]);
      return;
    }
    setLoadingActive(true);
    fetch(`/api/sessions/${encodeURIComponent(activeId)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((s: ServerSession) => setActiveMessages(toChatSession(s).messages))
      .catch(() => setActiveMessages([]))
      .finally(() => setLoadingActive(false));
  }, [activeId]);

  const createSession = useCallback(async (name?: string): Promise<string> => {
    const r = await fetch("/api/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(name ? { name } : {}),
    });
    const s = (await r.json()) as SessionSummary;
    await refresh();
    setActiveId(s.id);
    return s.id;
  }, [refresh]);

  const deleteSession = useCallback(
    async (id: string): Promise<void> => {
      await fetch(`/api/sessions/${encodeURIComponent(id)}`, { method: "DELETE" });
      setSummaries((prev) => {
        const next = prev.filter((s) => s.id !== id);
        if (id === activeId) {
          // Активна сесія видалена — скинути activeId (UI редиректить на дашборд).
          setActiveId(null);
        }
        return next;
      });
    },
    [activeId],
  );

  const renameSession = useCallback(async (id: string, name: string): Promise<void> => {
    await fetch(`/api/sessions/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    await refresh();
  }, [refresh]);

  const selectSession = useCallback((id: string): void => {
    setActiveId(id);
  }, []);

  // Заглушка відправки (реальний чат — Етап 2: /api/chat SSE).
  const sendMessage = useCallback((_content: string): void => {
    /* повідомлення зʼявляться в Етапі 2 */
  }, []);

  // Клієнтські представлення для Sidebar/ChatView.
  const sessions: ChatSession[] = summaries.map((s) => ({
    ...toSummaryItem(s),
    messages: s.id === activeId ? activeMessages : [],
    createdAt: Date.parse(s.createdAt) || Date.now(),
    updatedAt: Date.parse(s.updatedAt) || Date.now(),
  }));

  const activeSession: ChatSession | null =
    activeId && !loadingActive
      ? (sessions.find((s) => s.id === activeId) ?? null)
      : null;

  return {
    sessions,
    activeId,
    activeSession,
    createSession,
    deleteSession,
    renameSession,
    selectSession,
    sendMessage,
    refresh,
  };
}
