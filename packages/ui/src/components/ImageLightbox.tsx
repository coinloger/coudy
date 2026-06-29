import { useEffect } from "react";
import { X } from "lucide-react";

export interface ImageLightboxProps {
	/** data: URL (або будь-яке src) повнорозмірного зображення. */
	src: string;
	alt?: string;
	onClose: () => void;
}

/**
 * ImageLightbox — повноекранний overlay для перегляду збільшеного зображення.
 * Закриття: клік поза картинкою, кнопка X, або Esc. Reusable.
 */
export function ImageLightbox({ src, alt, onClose }: ImageLightboxProps): React.ReactNode {
	useEffect(() => {
		const onKey = (e: KeyboardEvent): void => {
			if (e.key === "Escape") onClose();
		};
		window.addEventListener("keydown", onKey);
		// Блокувати скрол фону.
		const prev = document.body.style.overflow;
		document.body.style.overflow = "hidden";
		return (): void => {
			window.removeEventListener("keydown", onKey);
			document.body.style.overflow = prev;
		};
	}, [onClose]);

	return (
		<div
			className="cc-ui-lightbox-overlay"
			onClick={onClose}
			role="dialog"
			aria-modal="true"
		>
			<button
				type="button"
				className="cc-ui-lightbox-close"
				onClick={onClose}
				title="Закрити (Esc)"
			>
				<X size={20} />
			</button>
			<img
				src={src}
				alt={alt ?? "attachment"}
				className="cc-ui-lightbox-img"
				onClick={(e) => e.stopPropagation()}
			/>
		</div>
	);
}
