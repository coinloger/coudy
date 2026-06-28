import type { ReactNode } from "react";

export interface PanelProps {
	/** Заголовок панелі (необовʼязково). */
	title?: string;
	/** Додаткові класи. */
	className?: string;
	/** Inline-стилі. */
	style?: React.CSSProperties;
	/** Контент панелі. */
	children?: ReactNode;
}

/**
 * Базова панель-контейнер для плагінів: картка з опц. заголовком, pi-палітра.
 * Експортується глобально як window.coudy.Panel.
 */
export function Panel({ title, className, style, children }: PanelProps): React.ReactNode {
	return (
		<div className={`cc-plugin-panel card ${className ?? ""}`.trim()} style={style}>
			{title && (
				<div className="card-header bg-transparent border-bottom-0 py-2">
					<span className="fw-semibold small">{title}</span>
				</div>
			)}
			<div className="card-body">{children}</div>
		</div>
	);
}

export interface CardProps {
	/** Заголовок картки (необовʼязково). */
	title?: string;
	/** Підзаголовок/опис (необовʼязково). */
	subtitle?: string;
	/** Додаткові класи. */
	className?: string;
	/** Inline-стилі. */
	style?: React.CSSProperties;
	/** Контент картки. */
	children?: ReactNode;
}

/**
 * Картка з заголовком + підзаголовком для плагінів (дашборд-блоки, конфіг).
 * Синонім Panel з підзаголовком. Експортується як window.coudy.Card.
 */
export function Card({ title, subtitle, className, style, children }: CardProps): React.ReactNode {
	return (
		<div className={`cc-plugin-card card ${className ?? ""}`.trim()} style={style}>
			{(title || subtitle) && (
				<div className="card-header bg-transparent border-bottom-0">
					{title && <div className="fw-semibold">{title}</div>}
					{subtitle && <div className="small text-muted">{subtitle}</div>}
				</div>
			)}
			<div className="card-body">{children}</div>
		</div>
	);
}
