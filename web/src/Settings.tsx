import { Settings as SettingsIcon } from "lucide-react";

export default function Settings(): React.ReactNode {
  return (
    <div className="p-4">
      <h2 className="h4 mb-4">Налаштування</h2>
      <div className="card border-0 shadow-sm">
        <div className="card-body text-center py-5">
          <SettingsIcon size={40} className="text-muted mb-3" />
          <h5 className="text-muted">Скоро</h5>
          <p className="text-muted small mb-0">
            Сторінка налаштувань зʼявиться у наступних етапах.
          </p>
        </div>
      </div>
    </div>
  );
}
