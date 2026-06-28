import { useCallback, useEffect, useState } from "react";
import { Download, FileText, Pencil, Plus, Trash2 } from "lucide-react";
import type { PromptTemplateEntry } from "./PromptSelector";

interface PromptTemplatesProps {}

/** CRUD-форма (створення/редагування). */
interface FormState {
	id: string | null;
	name: string;
	content: string;
}

const EMPTY_FORM: FormState = { id: null, name: "", content: "" };

/** Таба налаштувань «Шаблони системних промптів» — CRUD через /api/prompts. */
export default function PromptTemplates(_props: PromptTemplatesProps): React.ReactNode {
	const [templates, setTemplates] = useState<PromptTemplateEntry[]>([]);
	const [form, setForm] = useState<FormState | null>(null);
	const [saving, setSaving] = useState(false);
	const [seeding, setSeeding] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [notice, setNotice] = useState<string | null>(null);

	const refresh = useCallback(async (): Promise<void> => {
		try {
			const r = await fetch("/api/prompts");
			if (!r.ok) return;
			const data = (await r.json()) as { templates: PromptTemplateEntry[] };
			setTemplates(data.templates ?? []);
		} catch {
			/* ignore */
		}
	}, []);

	useEffect(() => {
		void refresh();
	}, [refresh]);

	const handleSave = async (): Promise<void> => {
		if (!form) return;
		const name = form.name.trim();
		if (!name) {
			setError("Введіть назву шаблону");
			return;
		}
		setSaving(true);
		setError(null);
		try {
			const isEdit = form.id !== null;
			const r = await fetch(
				isEdit ? `/api/prompts/${encodeURIComponent(form.id!)}` : "/api/prompts",
				{
					method: isEdit ? "PATCH" : "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ name, content: form.content }),
				},
			);
			if (!r.ok) {
				const j = (await r.json().catch(() => null)) as { error?: string } | null;
				throw new Error(j?.error ?? `HTTP ${r.status}`);
			}
			setForm(null);
			await refresh();
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		} finally {
			setSaving(false);
		}
	};

	const handleDelete = async (t: PromptTemplateEntry): Promise<void> => {
		if (!window.confirm(`Видалити шаблон «${t.name}»? Привʼязки сесій будуть скинуті до типового.`)) {
			return;
		}
		try {
			const r = await fetch(`/api/prompts/${encodeURIComponent(t.id)}`, { method: "DELETE" });
			if (!r.ok) {
				const j = (await r.json().catch(() => null)) as { error?: string } | null;
				throw new Error(j?.error ?? `HTTP ${r.status}`);
			}
			await refresh();
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		}
	};

	const handleSeed = async (): Promise<void> => {
		setSeeding(true);
		setError(null);
		setNotice(null);
		try {
			const r = await fetch("/api/prompts/seed", { method: "POST" });
			if (!r.ok) {
				const j = (await r.json().catch(() => null)) as { error?: string } | null;
				throw new Error(j?.error ?? `HTTP ${r.status}`);
			}
			const data = (await r.json()) as { added: number };
			setNotice(
				data.added > 0
					? `Додано ${data.added} шаблонів`
					: "Усі стандартні шаблони вже присутні",
			);
			await refresh();
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		} finally {
			setSeeding(false);
		}
	};

	const startEdit = (t: PromptTemplateEntry): void => {
		setForm({ id: t.id, name: t.name, content: t.content });
		setError(null);
	};

	return (
		<div className="row g-4">
			<div className="col-md-5">
				<div className="d-flex align-items-center justify-content-between mb-2">
					<h6 className="mb-0">Шаблони</h6>
					<div className="d-flex gap-2">
						<button
							type="button"
							className="btn btn-sm btn-outline-secondary d-flex align-items-center gap-1"
							onClick={() => void handleSeed()}
							disabled={seeding}
							title="Додати відсутні стандартні шаблони з pi"
						>
							<Download size={14} /> Завантажити стандартні
						</button>
						<button
							type="button"
							className="btn btn-sm btn-primary d-flex align-items-center gap-1"
							onClick={() => {
								setForm({ ...EMPTY_FORM });
								setError(null);
							}}
						>
							<Plus size={14} /> Створити
						</button>
					</div>
				</div>
				{notice && (
					<div className="alert alert-success py-2 small mb-2 d-flex align-items-center justify-content-between">
						<span>{notice}</span>
						<button type="button" className="btn btn-sm btn-link p-0 lh-1" onClick={() => setNotice(null)}>×</button>
					</div>
				)}
				{templates.length === 0 ? (
					<p className="text-muted small mb-0">
						Шаблонів ще нема. Створіть перший, щоб використовувати різні системні промпти в
						різних чатах.
					</p>
				) : (
					<ul className="list-group">
						{templates.map((t) => (
							<li
								key={t.id}
								className="list-group-item d-flex align-items-start gap-2 px-2 py-2"
							>
								<FileText size={16} className="text-secondary mt-1 flex-shrink-0" />
								<div className="flex-grow-1 min-w-0">
									<div className="fw-semibold text-truncate">{t.name}</div>
									<div className="text-muted small text-truncate">
										{t.content.slice(0, 80) || "(порожній)"}
									</div>
								</div>
								<button
									type="button"
									className="btn btn-sm btn-link text-secondary p-1"
									onClick={() => startEdit(t)}
									title="Редагувати"
								>
									<Pencil size={14} />
								</button>
								<button
									type="button"
									className="btn btn-sm btn-link text-danger p-1"
									onClick={() => void handleDelete(t)}
									title="Видалити"
								>
									<Trash2 size={14} />
								</button>
							</li>
						))}
					</ul>
				)}
			</div>

			<div className="col-md-7">
				{form ? (
					<div>
						<h6 className="mb-2">{form.id ? "Редагувати шаблон" : "Новий шаблон"}</h6>
						{error && <div className="alert alert-danger py-2 small">{error}</div>}
						<div className="mb-2">
							<label className="form-label small fw-semibold">Назва</label>
							<input
								type="text"
								className="form-control"
								placeholder="напр. «Програміст»"
								value={form.name}
								onChange={(e) => setForm({ ...form, name: e.target.value })}
								autoFocus
							/>
						</div>
						<div className="mb-2">
							<label className="form-label small fw-semibold">Системний промпт</label>
							<textarea
								className="form-control"
								rows={10}
								placeholder="Ти — …"
								value={form.content}
								onChange={(e) => setForm({ ...form, content: e.target.value })}
							/>
						</div>
						<div className="d-flex gap-2">
							<button
								type="button"
								className="btn btn-primary btn-sm"
								onClick={() => void handleSave()}
								disabled={saving}
							>
								{saving ? "Збереження…" : "Зберегти"}
							</button>
							<button
								type="button"
								className="btn btn-outline-secondary btn-sm"
								onClick={() => setForm(null)}
								disabled={saving}
							>
								Скасувати
							</button>
						</div>
					</div>
				) : (
					<div className="text-muted small">
						Оберіть шаблон для редагування або створіть новий. Кожен чат може використовувати свій
						шаблон (вибір у шапці чату).
					</div>
				)}
			</div>
		</div>
	);
}
