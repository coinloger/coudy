import { useCallback, useSyncExternalStore } from "react";
import { CheckCircle2, X } from "lucide-react";

/** Запис toast-у (клікабельний → перехід у чат). */
export interface ToastEntry {
	id: string;
	title: string;
	body?: string;
	onClick?: () => void;
}

const AUTO_DISMISS_MS = 6000;

class ToastStore {
	private readonly toasts = new Map<string, ToastEntry>();
	private readonly listeners = new Set<() => void>();
	// Стабільний кешований список (те саме посилання між змінами → useSyncExternalStore без циклу).
	private cachedList: ToastEntry[] = [];

	push(toast: Omit<ToastEntry, "id">): string {
		const id = `t-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
		this.toasts.set(id, { id, ...toast });
		this.rebuild();
		this.emit();
		// Авто-зникнення.
		setTimeout(() => this.dismiss(id), AUTO_DISMISS_MS);
		return id;
	}

	dismiss(id: string): void {
		if (this.toasts.delete(id)) {
			this.rebuild();
			this.emit();
		}
	}

	/** Перебудувати кешований список (тільки при реальній зміні toasts). */
	private rebuild(): void {
		this.cachedList = Array.from(this.toasts.values());
	}

	list(): ToastEntry[] {
		return this.cachedList;
	}

	subscribe(cb: () => void): () => void {
		this.listeners.add(cb);
		return () => {
			this.listeners.delete(cb);
		};
	}

	private emit(): void {
		for (const cb of this.listeners) cb();
	}
}

/** Глобальний singleton toast-сховище. */
export const toastStore = new ToastStore();

/** Хук: список активних toast-ів (useSyncExternalStore). */
export function useToasts(): ToastEntry[] {
	return useSyncExternalStore(
		(cb) => toastStore.subscribe(cb),
		() => toastStore.list(),
		() => toastStore.list(),
	);
}

/** Один toast (Bootstrap-стиль, клікабельний). */
function Toast({ toast }: { toast: ToastEntry }): React.ReactNode {
	const dismiss = useCallback(() => toastStore.dismiss(toast.id), [toast.id]);
	return (
		<div className="cc-toast" role="alert">
			<button
				type="button"
				className="cc-toast-body"
				onClick={() => {
					toast.onClick?.();
					dismiss();
				}}
			>
				<CheckCircle2 size={16} className="cc-toast-icon" />
				<div className="cc-toast-text">
					<div className="cc-toast-title fw-semibold">{toast.title}</div>
					{toast.body && <div className="cc-toast-sub text-muted">{toast.body}</div>}
				</div>
			</button>
			<button type="button" className="cc-toast-close" onClick={dismiss} title="Закрити">
				<X size={14} />
			</button>
		</div>
	);
}

/** Контейнер toast-ів (фіксований стек у куті). Рендерити один раз у App. */
export function ToastContainer(): React.ReactNode {
	const toasts = useToasts();
	if (toasts.length === 0) return null;
	return (
		<div className="cc-toast-container">
			{toasts.map((t) => (
				<Toast key={t.id} toast={t} />
			))}
		</div>
	);
}
