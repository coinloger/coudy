/**
 * Семантичні embeddings через локальну модель all-MiniLM-L6-v2 (384-dim).
 * Без API-ключа (ONNX runtime, ваги з HuggingFace, кешуються локально).
 *
 * Pipeline ініціалізується ліниво при першому використанні (singleton).
 * Модель завантажується один раз (~25MB), далі береться з кешу браузера ФС.
 */
import { env, pipeline } from "@xenova/transformers";

type FeatureExtractor = (text: string, opts: { pooling: string; normalize: boolean }) => Promise<{ data: Float32Array }>;

// Локальні моделі вимкнені — беремо з HuggingFace Hub (авто-кеш).
env.allowLocalModels = false;

let extractorPromise: Promise<FeatureExtractor> | null = null;

/**
 * Ліниво ініціалізувати feature-extraction pipeline.
 * Singleton — модель завантажується лише раз за життєвий цикл процесу.
 */
async function getExtractor(): Promise<FeatureExtractor> {
	if (!extractorPromise) {
		extractorPromise = pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2") as Promise<FeatureExtractor>;
	}
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
