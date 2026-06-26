import { useEffect, useState } from "react";
import { Puzzle } from "lucide-react";
import type { ApiPlugin, ApiPluginsResponse } from "./types";

export default function PluginManager(): React.ReactNode {
  const [plugins, setPlugins] = useState<ApiPlugin[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/plugins");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data: ApiPluginsResponse = await res.json();
        if (!cancelled) {
          setPlugins(data.plugins ?? []);
          setLoading(false);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="p-4">
      <h2 className="h4 mb-4">Плагіни</h2>

      {loading && (
        <div className="d-flex align-items-center gap-2 text-muted">
          <span className="spinner-border spinner-border-sm" role="status" />
          Завантаження…
        </div>
      )}

      {error && (
        <div className="alert alert-danger">
          Не вдалося завантажити плагіни: {error}
        </div>
      )}

      {!loading && !error && plugins.length === 0 && (
        <p className="text-muted">Плагінів не знайдено.</p>
      )}

      {!loading && !error && plugins.length > 0 && (
        <div className="row g-3">
          {plugins.map((p) => (
            <div className="col-md-6 col-lg-4" key={p.name}>
              <div className="card border-0 shadow-sm h-100">
                <div className="card-body">
                  <div className="d-flex align-items-start justify-content-between mb-2">
                    <div className="d-flex align-items-center gap-2">
                      <Puzzle size={20} className="text-primary" />
                      <h6 className="card-title mb-0">{p.title}</h6>
                    </div>
                    <span
                      className={`badge ${p.enabled ? "bg-success" : "bg-secondary"}`}
                    >
                      {p.enabled ? "увімкнено" : "вимкнено"}
                    </span>
                  </div>
                  <p className="card-text text-muted small mb-2">{p.description}</p>
                  <div className="d-flex gap-2 text-muted small">
                    <span className="badge bg-light text-dark border">
                      v{p.version}
                    </span>
                    <code className="text-muted">{p.name}</code>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
