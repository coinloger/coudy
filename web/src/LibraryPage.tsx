import { useCallback, useEffect, useMemo, useState } from "react";
import {
	Boxes,
	Search,
	Plus,
	Trash2,
	Play,
	Save,
	X,
	Loader2,
	Code2,
} from "lucide-react";
import type {
	LibraryFunction,
	LibraryFunctionDetail,
	ParamSpec,
	SearchResultItem,
} from "./types";

/** Формат-дата коротко. */
function fmtDate(ms: number): string {
	return new Date(ms).toLocaleDateString("uk-UA", { day: "2-digit", month: "short" });
}

/** Парсити JSON-рядок params (з textarea) → обʼєкт або null. */
function tryParseParams(text: string): Record<string, ParamSpec> | null {
	const trimmed = text.trim();
	if (!trimmed) return {};
	try {
		const parsed = JSON.parse(trimmed);
		if (parsed && typeof parsed === "object") return parsed as Record<string, ParamSpec>;
	} catch {
		/* ignore */
	}
	return null;
}

export default function LibraryPage(): React.ReactNode {
	const [functions, setFunctions] = useState<LibraryFunction[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	// Семантичний пошук.
	const [searchQuery, setSearchQuery] = useState("");
	const [searchResults, setSearchResults] = useState<SearchResultItem[] | null>(null);
	const [searching, setSearching] = useState(false);

	// Фільтр списку.
	const [categoryFilter, setCategoryFilter] = useState<string>("");
	const [textFilter, setTextFilter] = useState("");

	// Вибрана функція (деталі + редагування).
	const [selected, setSelected] = useState<LibraryFunctionDetail | null>(null);
	const [editCode, setEditCode] = useState("");
	const [editDesc, setEditDesc] = useState("");
	const [editTags, setEditTags] = useState("");
	const [editCategory, setEditCategory] = useState("");
	const [saving, setSaving] = useState(false);
	const [runResult, setRunResult] = useState<string | null>(null);
	const [runParams, setRunParams] = useState("{}");
	const [running, setRunning] = useState(false);

	// Створення нової.
	const [showCreate, setShowCreate] = useState(false);

	const refresh = useCallback(async (): Promise<void> => {
		try {
			const res = await fetch("/api/library");
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const data = (await res.json()) as { functions: LibraryFunction[] };
			setFunctions(data.functions ?? []);
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		void refresh();
	}, [refresh]);

	const categories = useMemo(() => {
		const set = new Set<string>();
		for (const f of functions) if (f.category) set.add(f.category);
		return Array.from(set).sort();
	}, [functions]);

	const filtered = useMemo(() => {
		return functions.filter((f) => {
			if (categoryFilter && f.category !== categoryFilter) return false;
			if (textFilter.trim()) {
				const q = textFilter.trim().toLowerCase();
				const hay = `${f.name} ${f.description} ${f.tags.join(" ")}`.toLowerCase();
				if (!hay.includes(q)) return false;
			}
			return true;
		});
	}, [functions, categoryFilter, textFilter]);

	/** Семантичний пошук у бібліотеці. */
	const doSearch = async (): Promise<void> => {
		const q = searchQuery.trim();
		if (!q) return;
		setSearching(true);
		setError(null);
		try {
			const res = await fetch("/api/library/search", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ query: q }),
			});
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const data = (await res.json()) as { results: SearchResultItem[] };
			setSearchResults(data.results ?? []);
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		} finally {
			setSearching(false);
		}
	};

	/** Відкрити функцію для перегляду/редагування. */
	const openFunction = async (name: string): Promise<void> => {
		try {
			const res = await fetch(`/api/library/${encodeURIComponent(name)}`);
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const data = (await res.json()) as LibraryFunctionDetail;
			setSelected(data);
			setEditCode(data.code);
			setEditDesc(data.description);
			setEditTags(data.tags.join(", "));
			setEditCategory(data.category ?? "");
			setRunResult(null);
			setRunParams("{}");
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		}
	};

	/** Зберегти зміни (PATCH). */
	const save = async (): Promise<void> => {
		if (!selected) return;
		setSaving(true);
		setError(null);
		try {
			const tags = editTags.split(",").map((t) => t.trim()).filter(Boolean);
			const res = await fetch(`/api/library/${encodeURIComponent(selected.name)}`, {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					description: editDesc,
					code: editCode,
					category: editCategory || undefined,
					tags,
				}),
			});
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			await refresh();
			await openFunction(selected.name);
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		} finally {
			setSaving(false);
		}
	};

	/** Видалити функцію. */
	const remove = async (name: string): Promise<void> => {
		if (!confirm(`Видалити функцію «${name}»?`)) return;
		try {
			const res = await fetch(`/api/library/${encodeURIComponent(name)}`, { method: "DELETE" });
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			if (selected?.name === name) {
				setSelected(null);
			}
			await refresh();
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		}
	};

	/** Виконати функцію (POST /run). */
	const runFunction = async (): Promise<void> => {
		if (!selected) return;
		setRunning(true);
		setRunResult(null);
		setError(null);
		try {
			const params = tryParseParams(runParams);
			if (params === null) {
				setRunResult("⚠ Невалідний JSON параметрів");
				return;
			}
			const res = await fetch(`/api/library/${encodeURIComponent(selected.name)}/run`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ params }),
			});
			const data = await res.json();
			if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
			setRunResult(JSON.stringify(data.result, null, 2));
		} catch (e) {
			setRunResult(`⚠ ${e instanceof Error ? e.message : String(e)}`);
		} finally {
			setRunning(false);
		}
	};

	return (
		<div className="cc-library-page">
			<div className="cc-library-header">
				<div className="cc-library-title-row">
					<Boxes size={22} style={{ color: "var(--pi-accent, #5a8080)" }} />
					<h2 className="cc-library-title">Бібліотека функцій</h2>
					<button
						type="button"
						className="btn btn-sm btn-primary cc-library-new-btn"
						onClick={() => setShowCreate(true)}
					>
						<Plus size={15} /> Нова функція
					</button>
				</div>
				<p className="cc-library-subtitle">
					Self-growing skill library: агент будує перевикористовувані функції, шукає та компонує їх.
				</p>
			</div>

			{error && (
				<div className="alert alert-danger cc-library-alert" onClick={() => setError(null)}>
					{error} <X size={14} style={{ cursor: "pointer", float: "right" }} />
				</div>
			)}

			<div className="cc-library-layout">
				{/* Ліва колонка: пошук + список */}
				<div className="cc-library-left">
					{/* Семантичний пошук */}
					<div className="cc-library-search-box">
						<div className="cc-library-search-row">
							<Search size={15} className="cc-library-search-icon" />
							<input
								type="text"
								className="form-control form-control-sm cc-library-search-input"
								placeholder="Семантичний пошук..."
								value={searchQuery}
								onChange={(e) => setSearchQuery(e.target.value)}
								onKeyDown={(e) => e.key === "Enter" && doSearch()}
							/>
							<button
								type="button"
								className="btn btn-sm btn-primary"
								onClick={doSearch}
								disabled={searching || !searchQuery.trim()}
							>
								{searching ? <Loader2 size={14} className="spin" /> : "Шукати"}
							</button>
						</div>
						{searchResults !== null && (
							<div className="cc-library-search-results">
								<div className="cc-library-results-label">
									Результати ({searchResults.length})
									<button
										type="button"
										className="btn btn-link btn-sm p-0 cc-library-clear-search"
										onClick={() => { setSearchResults(null); setSearchQuery(""); }}
									>
										очистити
									</button>
								</div>
								{searchResults.length === 0 && (
									<div className="cc-library-empty-search">Нічого не знайдено</div>
								)}
								{searchResults.map((r) => (
									<button
										type="button"
										key={r.name}
										className="cc-library-result-item"
										onClick={() => openFunction(r.name)}
									>
										<div className="cc-library-result-name">
											{r.name}
											<span className="cc-library-score">{(r.score * 100).toFixed(0)}%</span>
										</div>
										<div className="cc-library-result-desc">{r.description}</div>
										{r.category && <span className="cc-library-cat-badge">{r.category}</span>}
									</button>
								))}
							</div>
						)}
					</div>

					{/* Фільтр + список */}
					<div className="cc-library-filter-row">
						<input
							type="text"
							className="form-control form-control-sm"
							placeholder="Фільтр..."
							value={textFilter}
							onChange={(e) => setTextFilter(e.target.value)}
						/>
						<select
							className="form-select form-select-sm cc-library-cat-select"
							value={categoryFilter}
							onChange={(e) => setCategoryFilter(e.target.value)}
						>
							<option value="">Усі категорії</option>
							{categories.map((c) => (
								<option key={c} value={c}>{c}</option>
							))}
						</select>
					</div>

					<div className="cc-library-list">
						{loading ? (
							<div className="cc-library-loading"><Loader2 size={20} className="spin" /> Завантаження…</div>
						) : filtered.length === 0 ? (
							<div className="cc-library-empty">
								{functions.length === 0
									? "Бібліотека порожня. Створіть першу функцію."
									: "Нічого не знайдено за фільтром."}
							</div>
						) : (
							filtered.map((f) => (
								<div
									key={f.name}
									className={`cc-library-card ${selected?.name === f.name ? "active" : ""}`}
									onClick={() => openFunction(f.name)}
								>
									<div className="cc-library-card-top">
										<Code2 size={14} className="cc-library-card-icon" />
										<span className="cc-library-card-name">{f.name}</span>
										{f.category && <span className="cc-library-cat-badge">{f.category}</span>}
									</div>
									<div className="cc-library-card-desc">{f.description}</div>
									{f.tags.length > 0 && (
										<div className="cc-library-card-tags">
											{f.tags.map((t) => (
												<span key={t} className="cc-library-tag">{t}</span>
											))}
										</div>
									)}
									<div className="cc-library-card-meta">{fmtDate(f.updatedAt)}</div>
								</div>
							))
						)}
					</div>
				</div>

				{/* Права колонка: деталі/редагування */}
				<div className="cc-library-right">
					{selected ? (
						<div className="cc-library-detail">
							<div className="cc-library-detail-header">
								<h3 className="cc-library-detail-name">
									<Code2 size={18} /> {selected.name}
								</h3>
								<div className="cc-library-detail-actions">
									<button
										type="button"
										className="btn btn-sm btn-outline-danger"
										onClick={() => remove(selected.name)}
										title="Видалити"
									>
										<Trash2 size={14} />
									</button>
									<button
										type="button"
										className="btn btn-sm btn-primary"
										onClick={save}
										disabled={saving}
									>
										{saving ? <Loader2 size={14} className="spin" /> : <Save size={14} />}
										Зберегти
									</button>
								</div>
							</div>

							<div className="cc-library-field">
								<label>Опис</label>
								<textarea
									className="form-control form-control-sm"
									rows={2}
									value={editDesc}
									onChange={(e) => setEditDesc(e.target.value)}
								/>
							</div>

							<div className="cc-library-field-row">
								<div className="cc-library-field">
									<label>Категорія</label>
									<input
										type="text"
										className="form-control form-control-sm"
										value={editCategory}
										onChange={(e) => setEditCategory(e.target.value)}
									/>
								</div>
								<div className="cc-library-field">
									<label>Теги (через кому)</label>
									<input
										type="text"
										className="form-control form-control-sm"
										value={editTags}
										onChange={(e) => setEditTags(e.target.value)}
									/>
								</div>
							</div>

							<div className="cc-library-field">
								<label>Код (ESM модуль: meta + run)</label>
								<textarea
									className="cc-library-code-editor"
									rows={16}
									value={editCode}
									onChange={(e) => setEditCode(e.target.value)}
									spellCheck={false}
								/>
							</div>

							{/* Виконання */}
							<div className="cc-library-run-box">
								<div className="cc-library-run-header">
									<Play size={14} /> Виконати
								</div>
								<textarea
									className="form-control form-control-sm cc-library-run-params"
									rows={3}
									value={runParams}
									onChange={(e) => setRunParams(e.target.value)}
									placeholder='{"param":"value"}'
									spellCheck={false}
								/>
								<button
									type="button"
									className="btn btn-sm btn-outline-primary mt-1"
									onClick={runFunction}
									disabled={running}
								>
									{running ? <Loader2 size={14} className="spin" /> : <Play size={14} />}
									Виконати
								</button>
								{runResult !== null && (
									<pre className="cc-library-run-result">{runResult}</pre>
								)}
							</div>
						</div>
					) : (
						<div className="cc-library-no-select">
							<Boxes size={40} />
							<p>Оберіть функцію для перегляду та редагування</p>
						</div>
					)}
				</div>
			</div>

			{showCreate && (
				<CreateFunctionDialog
					onClose={() => setShowCreate(false)}
					onCreated={(name) => { setShowCreate(false); void refresh(); void openFunction(name); }}
				/>
			)}
		</div>
	);
}

/** Модальне вікно створення нової функції. */
function CreateFunctionDialog({
	onClose,
	onCreated,
}: {
	onClose: () => void;
	onCreated: (name: string) => void;
}): React.ReactNode {
	const [name, setName] = useState("");
	const [description, setDescription] = useState("");
	const [category, setCategory] = useState("");
	const [tags, setTags] = useState("");
	const [params, setParams] = useState("{}");
	const [code, setCode] = useState(DEFAULT_FUNCTION_TEMPLATE);
	const [creating, setCreating] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const create = async (): Promise<void> => {
		setError(null);
		if (!name.trim() || !description.trim()) {
			setError("Потрібні поля name та description");
			return;
		}
		const parsedParams = tryParseParams(params);
		if (parsedParams === null) {
			setError("Невалідний JSON параметрів");
			return;
		}
		setCreating(true);
		try {
			const res = await fetch("/api/library", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					name: name.trim(),
					description: description.trim(),
					category: category.trim() || undefined,
					tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
					params: parsedParams,
					code,
				}),
			});
			const data = await res.json();
			if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
			onCreated(name.trim());
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		} finally {
			setCreating(false);
		}
	};

	return (
		<div className="cc-library-modal-overlay" onClick={onClose}>
			<div className="cc-library-modal" onClick={(e) => e.stopPropagation()}>
				<div className="cc-library-modal-header">
					<h3><Plus size={18} /> Нова функція</h3>
					<button type="button" className="btn btn-link btn-sm p-0" onClick={onClose}>
						<X size={18} />
					</button>
				</div>
				{error && <div className="alert alert-danger cc-library-alert">{error}</div>}
				<div className="cc-library-modal-body">
					<div className="cc-library-field-row">
						<div className="cc-library-field">
							<label>Імʼя *</label>
							<input type="text" className="form-control form-control-sm" value={name} onChange={(e) => setName(e.target.value)} placeholder="my_function" />
						</div>
						<div className="cc-library-field">
							<label>Категорія</label>
							<input type="text" className="form-control form-control-sm" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="markets" />
						</div>
					</div>
					<div className="cc-library-field">
						<label>Опис *</label>
						<textarea className="form-control form-control-sm" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
					</div>
					<div className="cc-library-field-row">
						<div className="cc-library-field">
							<label>Теги</label>
							<input type="text" className="form-control form-control-sm" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="price, market" />
						</div>
					</div>
					<div className="cc-library-field">
						<label>Параметри (JSON)</label>
						<textarea className="form-control form-control-sm" rows={3} value={params} onChange={(e) => setParams(e.target.value)} spellCheck={false} />
					</div>
					<div className="cc-library-field">
						<label>Код</label>
						<textarea className="cc-library-code-editor" rows={14} value={code} onChange={(e) => setCode(e.target.value)} spellCheck={false} />
					</div>
				</div>
				<div className="cc-library-modal-footer">
					<button type="button" className="btn btn-sm btn-secondary" onClick={onClose}>Скасувати</button>
					<button type="button" className="btn btn-sm btn-primary" onClick={create} disabled={creating}>
						{creating ? <Loader2 size={14} className="spin" /> : <Plus size={14} />}
						Створити
					</button>
				</div>
			</div>
		</div>
	);
}

/** Шаблон за замовчуванням для нової функції. */
const DEFAULT_FUNCTION_TEMPLATE = `export const meta = {
  name: "my_function",
  description: "Опиши що робить функція",
  params: { input: { type: "string", required: true, desc: "вхідні дані" } },
  tags: [],
};

export async function run(params, ctx) {
  // ctx.fs / ctx.sh / ctx.proc / ctx.db / ctx.path / ctx.call(name, params)
  const result = { echo: params.input };
  return result;
}
`;
