import type { ReactNode } from "react";
import { X } from "lucide-react";

export interface ModalProps {
	open: boolean;
	title: string;
	onClose: () => void;
	children: ReactNode;
	footer?: ReactNode;
}

/**
 * Reusable модалке на базі cc-modal-* (як AddProviderDialog).
 * Escape-закриття; клік по backdrop закриває; клік у модалці ні.
 */
export function Modal({ open, title, onClose, children, footer }: ModalProps): ReactNode {
	if (!open) return null;
	return (
		<div className="cc-modal-backdrop" onClick={onClose}>
			<div className="cc-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
				<div className="cc-modal-head">
					<span className="cc-modal-title">{title}</span>
					<button type="button" className="cc-modal-close" onClick={onClose} aria-label="Закрити">
						<X size={16} />
					</button>
				</div>
				<div className="cc-modal-body">
					{children}
					{footer && <div className="cc-modal-actions">{footer}</div>}
				</div>
			</div>
		</div>
	);
}
