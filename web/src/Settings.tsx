import { useState } from "react";
import ModelsSettings from "./ModelsSettings";

type TabId = "models" | "general";

interface TabDef {
	id: TabId;
	label: string;
}

const TABS: TabDef[] = [
	{ id: "models", label: "Моделі" },
	{ id: "general", label: "Загальне" },
];

/** Сторінка налаштувань — табчаста. Перша таба «Моделі» (підключення провайдерів). */
export default function Settings(): React.ReactNode {
	const [tab, setTab] = useState<TabId>("models");

	return (
		<div className="p-4">
			<h2 className="h4 mb-4">Налаштування</h2>
			<div className="cc-tabs">
				{TABS.map((t) => (
					<button
						key={t.id}
						type="button"
						className={`cc-tab${tab === t.id ? " cc-tab-active" : ""}`}
						onClick={() => setTab(t.id)}
					>
						{t.label}
					</button>
				))}
			</div>

			{tab === "models" && <ModelsSettings />}
			{tab === "general" && (
				<div className="cc-tab-placeholder">Загальні налаштування — скоро.</div>
			)}
		</div>
	);
}
