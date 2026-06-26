/**
 * Tools manager — мінімальна headless-версія.
 *
 * На відміну від pi-донора, ЦЕЙ пакет не завантажує rg/fd з GitHub-релізів.
 * Інструменти очікують `ripgrep` (rg) та `fd` у системному PATH. Якщо їх немає —
 * getToolPath повертає null, а ensureTool кидає зрозумілу помилку з інструкцією встановлення.
 */

import { spawnSync } from "node:child_process";

export type ManagedTool = "fd" | "rg";

const TOOL_SYSTEM_NAMES: Record<ManagedTool, string[]> = {
	fd: ["fd", "fdfind"],
	rg: ["rg"],
};

const TOOL_LABEL: Record<ManagedTool, string> = {
	fd: "fd",
	rg: "ripgrep",
};

const TOOL_INSTALL_HINT: Record<ManagedTool, string> = {
	fd: "brew install fd  |  apt install fd-find  |  choco install fd",
	rg: "brew install ripgrep  |  apt install ripgrep  |  choco install ripgrep",
};

/**
 * Перевірити, чи команда доступна в PATH (пробний запуск --version).
 */
function commandExists(cmd: string): boolean {
	try {
		const result = spawnSync(cmd, ["--version"], { stdio: "pipe", timeout: 5000 });
		return result.error === undefined || result.error === null;
	} catch {
		return false;
	}
}

/**
 * Повертає ім'я команди (з PATH), якщо інструмент знайдено, інакше null.
 */
export function getToolPath(tool: ManagedTool): string | null {
	for (const name of TOOL_SYSTEM_NAMES[tool]) {
		if (commandExists(name)) return name;
	}
	return null;
}

/**
 * Гарантує наявність інструменту. Якщо відсутній — кидає помилку з підказкою встановлення.
 * Параметр `silent` збережено для сумісності з сигнатурою донора (ігнорується).
 */
export async function ensureTool(tool: ManagedTool, silent = false): Promise<string> {
	void silent;
	const path = getToolPath(tool);
	if (path) return path;
	throw new Error(
		`${TOOL_LABEL[tool]} не знайдено в PATH. Встановіть його:\n  ${TOOL_INSTALL_HINT[tool]}`,
	);
}
