import { useCallback, useEffect, useState } from "react";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: number;
}

export interface ChatSession {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
}

const STORAGE_KEY = "coudycode:sessions";
const ACTIVE_KEY = "coudycode:active-session";

function loadSessions(): ChatSession[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as ChatSession[]) : [];
  } catch {
    return [];
  }
}

function saveSessions(sessions: ChatSession[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
  } catch {
    /* localStorage може бути недоступний — ігноруємо */
  }
}

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

function uid(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function deriveTitle(content: string): string {
  const trimmed = content.trim();
  if (!trimmed) return "Новий чат";
  return trimmed.length > 40 ? `${trimmed.slice(0, 40)}…` : trimmed;
}

/**
 * Локальні сесії чату (state + localStorage). Поки без реального LLM —
 * каркас: створення/вибір/видалення сесій, історія повідомлень.
 */
export function useSessions() {
  const [sessions, setSessions] = useState<ChatSession[]>(() => loadSessions());
  const [activeId, setActiveId] = useState<string | null>(() => loadActiveId());

  useEffect(() => {
    saveSessions(sessions);
  }, [sessions]);

  useEffect(() => {
    saveActiveId(activeId);
  }, [activeId]);

  const createSession = useCallback((): string => {
    const session: ChatSession = {
      id: uid(),
      title: "Новий чат",
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    setSessions((prev) => [session, ...prev]);
    setActiveId(session.id);
    return session.id;
  }, []);

  const deleteSession = useCallback(
    (id: string) => {
      setSessions((prev) => {
        const next = prev.filter((s) => s.id !== id);
        if (id === activeId) {
          setActiveId(next.length > 0 ? next[0].id : null);
        }
        return next;
      });
    },
    [activeId],
  );

  const selectSession = useCallback((id: string) => {
    setActiveId(id);
  }, []);

  const sendMessage = useCallback((content: string) => {
    const trimmed = content.trim();
    if (!trimmed || !activeId) return;
    const userMsg: ChatMessage = {
      id: uid(),
      role: "user",
      content: trimmed,
      createdAt: Date.now(),
    };
    // Заглушка відповіді асистента (без реального LLM).
    const assistantMsg: ChatMessage = {
      id: uid(),
      role: "assistant",
      content: "Це демо-відповідь. Підключення LLM — у наступному етапі.",
      createdAt: Date.now() + 1,
    };
    setSessions((prev) =>
      prev.map((s) =>
        s.id === activeId
          ? {
              ...s,
              title: s.messages.length === 0 ? deriveTitle(trimmed) : s.title,
              messages: [...s.messages, userMsg, assistantMsg],
              updatedAt: Date.now(),
            }
          : s,
      ),
    );
  }, [activeId]);

  const activeSession = sessions.find((s) => s.id === activeId) ?? null;

  return {
    sessions,
    activeId,
    activeSession,
    createSession,
    deleteSession,
    selectSession,
    sendMessage,
  };
}
