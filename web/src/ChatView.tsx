import { useEffect, useRef, useState } from "react";
import { Send } from "lucide-react";
import type { ChatSession } from "./sessions";

interface ChatViewProps {
  session: ChatSession | null;
  onSend: (content: string) => void;
}

export default function ChatView({ session, onSend }: ChatViewProps): React.ReactNode {
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [session?.messages]);

  const handleSubmit = (e: React.FormEvent): void => {
    e.preventDefault();
    if (!input.trim()) return;
    onSend(input);
    setInput("");
  };

  if (!session) {
    return (
      <div className="d-flex align-items-center justify-content-center h-100 text-muted">
        <div className="text-center">
          <p className="mb-0">Оберіть або створіть сесію у сайдбарі.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="d-flex flex-column h-100">
      <div className="border-bottom px-4 py-3">
        <h6 className="mb-0 text-truncate">{session.title}</h6>
      </div>

      <div ref={scrollRef} className="flex-grow-1 overflow-auto px-4 py-3">
        {session.messages.length === 0 ? (
          <div className="text-muted text-center mt-5">
            Напишіть перше повідомлення, щоб почати розмову.
          </div>
        ) : (
          <div className="d-flex flex-column gap-3">
            {session.messages.map((m) => (
              <div
                key={m.id}
                className={`d-flex ${
                  m.role === "user" ? "justify-content-end" : "justify-content-start"
                }`}
              >
                <div
                  className={`rounded-3 px-3 py-2 ${
                    m.role === "user"
                      ? "bg-primary text-white"
                      : "bg-light text-body"
                  }`}
                  style={{ maxWidth: "75%" }}
                >
                  <div className="small">{m.content}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="border-top p-3">
        <form onSubmit={handleSubmit} className="d-flex gap-2">
          <input
            type="text"
            className="form-control"
            placeholder="Напишіть повідомлення…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
          />
          <button type="submit" className="btn btn-primary" disabled={!input.trim()}>
            <Send size={18} />
          </button>
        </form>
      </div>
    </div>
  );
}
