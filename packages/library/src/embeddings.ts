/**
 * Семантичні embeddings через локальну модель all-MiniLM-L6-v2 (384-dim).
 * Без API-ключа (ONNX runtime, ваги з HuggingFace, кешуються локально).
 *
 * ПАМʼЯТЬ: @xenova/transformers + onnxruntime-node важать ~160MB RAM.
 * Тому pipeline ініціалізується ЛІНИВО (dynamic import всередині getExtractor)
 * лише при першому реальному використанні (library_search), а НЕ при старті сервера.
 * Після IDLE-таймауту (5 хв без використання) модель вивантажується (GC) —
 * щоб не тримати RAM постійно, коли embeddings не потрібні.
 */

type FeatureExtractor = (
	text: string,
	opts: { pooling: string; normalize: boolean },
) => Promise<{ data: Float32Array }>;

/** Скільки часу модель тримати в RAM після останнього використання (5 хв). */
const IDLE_UNLOAD_MS = 5 * 60 * 1000;

let extractorPromise: Promise<FeatureExtractor> | null = null;
/** Timestamp останнього використання моделі (мс). */
let lastUsed = 0;
/** Таймер idle-unload. */
let unloadTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Скинути pipeline (вивантажити модель → дозволити GC прибрати ~160MB).
 * Наступний getExtractor() пересcreate-не її заново.
 */
function unloadExtractor(): void {
	extractorPromise = null;
	lastUsed = 0;
	if (unloadTimer) {
		clearTimeout(unloadTimer);
		unloadTimer = null;
	}
}

/**
 * Експорт для явного cleanup (напр. при shutdown): вивантажити embeddings-модель.
 */
export function unloadEmbeddings(): void {
	unloadExtractor();
}

/**
 * Запланувати idle-unload через IDLE_UNLOAD_MS. Скидається при кожному embed().
 */
function scheduleIdleUnload(): void {
	if (unloadTimer) clearTimeout(unloadTimer);
	unloadTimer = setTimeout(unloadExtractor, IDLE_UNLOAD_MS);
}

/**
 * Ліниво ініціалізувати feature-extraction pipeline (dynamic import).
 * onnxruntime (92MB) НЕ вантажиться при старті процесу — лише тут.
 * Singleton між використаннями; вивантажується через IDLE_UNLOAD_MS бездіяльності.
 */
async function getExtractor(): Promise<FeatureExtractor> {
	if (!extractorPromise) {
		// Dynamic import: onnxruntime-node не підвантажується, поки цей import не виконається.
		const { env, pipeline } = await import("@xenova/transformers");
		env.allowLocalModels = false;
		extractorPromise = pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2") as Promise<FeatureExtractor>;
	}
	lastUsed = Date.now();
	scheduleIdleUnload();
	return extractorPromise;
}

/**
 * Розрахувати embedding-вектор для тексту (384-dim, L2-нормалізований).
 * Використовується для індексування описів функцій при create/modify.
 */
export async function embed(text: string): Promise<number[]> {
	const extractor = await getExtractor();
	const out = await extractor(text, { pooling: "mean", normalize: true });
	return Array.from(out.data);
}

/**
 * Cosine similarity двох векторів.
 * Вектори передбачається L2-нормалізованими → спрощується до скалярного добутку.
 */
export function cosine(a: number[], b: number[]): number {
	if (a.length !== b.length || a.length === 0) return 0;
	let dot = 0;
	for (let i = 0; i < a.length; i++) {
		dot += a[i]! * b[i]!;
	}
	return dot;
}
