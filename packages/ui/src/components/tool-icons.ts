/**
 * Lucide-іконки для типів інструментів та статусів.
 * Замінюють спецсимволи/емодзі (⏺ ✓ ✕) у tool-рендерингу.
 */
import {
	Check,
	ChevronDown,
	ChevronRight,
	CircleAlert,
	FilePlus,
	FileText,
	Folder,
	FolderSearch,
	Globe,
	Loader2,
	Search,
	SquarePen,
	Terminal,
	type LucideIcon,
} from "lucide-react";

/** Іконка за типом інструменту. */
export const TOOL_ICON: Record<string, LucideIcon> = {
	read: FileText,
	edit: SquarePen,
	write: FilePlus,
	bash: Terminal,
	grep: Search,
	find: FolderSearch,
	ls: Folder,
	fetch: Globe,
};

/** Іконка за замовчуванням для невідомого типу. */
export const DEFAULT_TOOL_ICON: LucideIcon = Terminal;

export { Check, ChevronDown, ChevronRight, CircleAlert, Loader2 };
