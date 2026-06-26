import { useEffect, useState } from "react";
import { Boxes, Sparkles } from "lucide-react";
import type { DashboardWidget } from "./types";
import type { ApiStateResponse } from "./types";

interface DashboardProps {
  widgets: DashboardWidget[];
}

function WelcomeCard(): React.ReactNode {
  return (
    <div className="card border-0 shadow-sm h-100">
      <div className="card-body">
        <div className="d-flex align-items-center gap-2 mb-2">
          <Sparkles size={20} className="text-warning" />
          <h5 className="card-title mb-0">Вітаємо в coudycode</h5>
        </div>
        <p className="card-text text-muted small mb-0">
          Хаб екосистеми з плагінною архітектурою. Створюйте сесії, керуйте
          модулями та розширюйте можливості через плагіни.
        </p>
      </div>
    </div>
  );
}

function PluginsStatCard({ count }: { count: number | null }): React.ReactNode {
  return (
    <div className="card border-0 shadow-sm h-100">
      <div className="card-body">
        <div className="d-flex align-items-center gap-2 mb-2">
          <Boxes size={20} className="text-primary" />
          <h6 className="card-title mb-0 text-muted text-uppercase small">
            Активні плагіни
          </h6>
        </div>
        <div className="display-6 fw-bold">
          {count === null ? (
            <span className="spinner-border spinner-border-sm" role="status" />
          ) : (
            count
          )}
        </div>
      </div>
    </div>
  );
}

export default function Dashboard({ widgets }: DashboardProps): React.ReactNode {
  const [pluginsCount, setPluginsCount] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/state");
        if (!res.ok) return;
        const data: ApiStateResponse = await res.json();
        if (!cancelled) setPluginsCount(data.pluginsCount);
      } catch {
        /* бекенд може бути недоступний — лишаємо заглушку */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="p-4">
      <h2 className="h4 mb-4">Дашборд</h2>
      <div className="row g-3">
        <div className="col-md-6 col-lg-4">
          <WelcomeCard />
        </div>
        <div className="col-md-6 col-lg-4">
          <PluginsStatCard count={pluginsCount} />
        </div>
        {widgets.map((w) => (
          <div className="col-md-6 col-lg-4" key={w.id}>
            <div className="card border-0 shadow-sm h-100">
              <div className="card-body">
                <h6 className="card-title text-muted text-uppercase small mb-3">
                  {w.title}
                </h6>
                {w.render()}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
