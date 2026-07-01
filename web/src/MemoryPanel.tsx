import { useCallback, useEffect, useState } from "react";
import { NotebookPen, Trash2 } from "lucide-react";
import { Modal } from "./Modal";
import { type MemoryItem, getMemory, deleteMemoryItem } from "./projects";
import { toastStore } from "./Toast";

interface MemoryPanelProps {
	open: boolean;
	project: { id: string; name: string } | null;
	onClose: () => void;
}

/** Панель памʼяті проєкту: перегляд + видалення правил. */
export function MemoryPanel({ open, project, onClose }: MemoryPanelProps): React.ReactNode {
	const [items, setItems] = useState<MemoryItem[]>([]);
	const [loading, setLoading] = useState(false);

	const load = useCallback(async (): Promise<void> => {
		if (!project) {
			setItems([]);
			return;
		}
		setLoading(true);
		try {
			setItems(await getMemory(project.id));
		} finally {
			setLoading(false);
		}
	}, [project]);

	useEffect(() => {
		if (open) void load();
	}, [open, load]);

	const handleDelete = async (itemId: string): Promise<void> => {
		if (!project) return;
		const ok = await deleteMemoryItem(project.id, itemId);
		if (ok) {
			setItems((prev) => prev.filter((i) => i.id !== itemId));
		} else {
			toastStore.push({ title: "Не вдалося видалити правило" });
		}
	};

	return (
		<Modal
			open={open}
			title={`Памʼять · ${project?.name ?? ""}`}
			onClose={onClose}
			footer={
				<button type="button" className="btn btn-sm btn-secondary" onClick={onClose}>
					Закрити
				</button>
			}
		>
			<p className="small text-muted mb-2">
				Правила інжектяться в system-prompt проєктних сесій. Агент дотримується їх автоматично.
			</p>
			{loading ? (
				<div className="small text-muted py-2">Завантаження…</div>
			) : items.length === 0 ? (
				<div className="cc-memory-empty">
					<NotebookPen size={22} className="text-muted mb-2" />
					<div className="small text-muted">
						Правил ще немає. Скажи агенту <em>«запамʼятай …»</em> у чаті проєкту.
					</div>
				</div>
			) : (
				<ul className="list-unstyled d-flex flex-column gap-2 mb-0">
					{items.map((item) => (
						<li key={item.id} className="cc-memory-item">
							<span className="cc-memory-item-text small">{item.text}</span>
							<button
								type="button"
								className="btn btn-sm btn-link text-danger p-0 flex-shrink-0"
								title="Видалити правило"
								onClick={() => void handleDelete(item.id)}
							>
								<Trash2 size={15} />
							</button>
						</li>
					))}
				</ul>
			)}
		</Modal>
	);
}
