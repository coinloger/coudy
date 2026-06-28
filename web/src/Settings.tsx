import { useState } from "react";
import ModelsSettings from "./ModelsSettings";
import PromptTemplates from "./PromptTemplates";
import type { SettingsTab } from "./types";

/** Стандартні (ядерні) таби налаштувань. */
const CORE_TABS: SettingsTab[] = [
	{ id: "models", label: "Моделі", render: () => <ModelsSettings /> },
	{ id: "prompts", label: "Шаблони промптів", render: () => <PromptTemplates /> },
	{
		id: "general",
		label: "Загальне",
		render: () => <div className="cc-tab-placeholder">Загальні налаштування — скоро.</div>,
	},
];

/**
 * Сторінка налаштувань — табчаста. Ядерні таби (Моделі/Загальне) +
 * плагінні таби (ui:settings-tabs). Активна таба рендерить свій render().
 */
export default function Settings({ tabs = [] }: { tabs?: SettingsTab[] }): React.ReactNode {
	// Плагінні таби додаються після ядерних; id плагінних не мають конфліктувати.
	const allTabs = [...CORE_TABS, ...tabs];
	const [tab, setTab] = useState<string>(allTabs[0]?.id ?? "models");
	const active = allTabs.find((t) => t.id === tab) ?? allTabs[0];

	return (
		<div className="p-4">
			<h2 className="h4 mb-4">Налаштування</h2>
			<div className="cc-tabs">
				{allTabs.map((t) => (
					<button
						key={t.id}
						type="button"
						className={`cc-tab${active?.id === t.id ? " cc-tab-active" : ""}`}
						onClick={() => setTab(t.id)}
					>
						{t.label}
					</button>
				))}
			</div>

			<div className="mt-3">{active?.render()}</div>
		</div>
	);
}
