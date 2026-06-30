/**
 * @coudycode/library — self-growing глобальна бібліотека функцій.
 *
 * Store + embeddings-пошук + контекст виконання з композицією (ctx.call).
 */

export { LibraryStore, SessionScriptStore, type LibraryStoreOptions } from "./store.ts";
export { embed, cosine, unloadEmbeddings } from "./embeddings.ts";
export type {
	FunctionMeta,
	FunctionModule,
	LibraryCtx,
	LibraryEntry,
	LibraryManifestFile,
	ParamSpec,
	ParamType,
	ParamsSpec,
	SearchResult,
} from "./types.ts";
export { LibraryError } from "./types.ts";
