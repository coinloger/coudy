import type { ImageContent } from "@coudycode/ai";

/**
 * Прочитати File (зображення) → base64 ImageContent.
 * Асинхронний FileReader; resolve з ImageContent або null (невалідний/не-data-URL).
 */
export function fileToImage(file: File): Promise<ImageContent | null> {
	return new Promise((resolve) => {
		const reader = new FileReader();
		reader.onload = (): void => {
			const result = reader.result;
			if (typeof result !== "string") {
				resolve(null);
				return;
			}
			// result = "data:image/png;base64,..." → витягти base64 + mimeType.
			const match = /^data:([^;]+);base64,(.+)$/.exec(result);
			if (!match) {
				resolve(null);
				return;
			}
			resolve({ type: "image", data: match[2], mimeType: match[1] });
		};
		reader.onerror = (): void => resolve(null);
		reader.readAsDataURL(file);
	});
}

/**
 * Додати файлові зображення з кліпборду/файлового інпуту до стану images.
 * Робить масив File[] → ImageContent[] (послідовно) → викликає append.
 */
export function filesToImages(files: File[], append: (imgs: ImageContent[]) => void): void {
	if (files.length === 0) return;
	void Promise.all(files.map(fileToImage)).then((imgs) => {
		const valid = imgs.filter((i): i is ImageContent => i !== null);
		if (valid.length > 0) append(valid);
	});
}

/**
 * Витягти зображення з paste-події (clipboardData.items).
 * Повертає File[] зображень (може бути порожнім). НЕ чіпає текст.
 */
export function imagesFromPaste(e: React.ClipboardEvent): File[] {
	const items = e.clipboardData?.items;
	if (!items) return [];
	const files: File[] = [];
	for (const item of Array.from(items)) {
		if (item.kind === "file" && item.type.startsWith("image/")) {
			const f = item.getAsFile();
			if (f) files.push(f);
		}
	}
	return files;
}

/**
 * Чи відкритий якийсь блокуючий overlay (командна палітра, модалка, lightbox).
 * Глобальний перехоплювач клавіш НЕ повинен перехоплювати поки overlay активний.
 */
export function isBlockingOverlayOpen(): boolean {
	return (
		!!document.querySelector(
			".cc-palette-overlay, .cc-library-modal-overlay, .cc-image-lightbox, .modal.show, [role='dialog']",
		) ||
		// Кастомні плагінні оверлеї: довільні модалки можуть не мати стандартних класів,
		// тож перевіряємо body-lock (багато бібліотек блокують scroll при модалці).
		document.body.classList.contains("modal-open")
	);
}

/**
 * Чи знаходиться фокус у полі вводу (input/textarea/contenteditable/select).
 * Якщо так — НЕ перехоплювати клавішу (дозволити звичайний набір).
 */
export function isFocusInEditable(el: Element | null): boolean {
	if (!el) return false;
	const tag = el.tagName;
	return (
		tag === "INPUT" ||
		tag === "TEXTAREA" ||
		tag === "SELECT" ||
		(el as HTMLElement).isContentEditable
	);
}
