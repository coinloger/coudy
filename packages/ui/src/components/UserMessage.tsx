import { useState } from "react";
import type { UserMessage as UserMessageType } from "@coudycode/ai";
import type { ImageContent, TextContent } from "@coudycode/ai";
import { ImageLightbox } from "./ImageLightbox.tsx";
import { MessageActionsBar } from "./message-actions.tsx";
import type { MessageAction } from "./message-actions.tsx";

export interface UserMessageProps {
	message: UserMessageType;
	/** Дії на повідомленнях (від плагінів ui:message-actions). */
	actions?: MessageAction[];
}

/** Повідомлення користувача. */
export function UserMessage({ message, actions }: UserMessageProps): React.ReactNode {
	const text = extractText(message.content);
	const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
	return (
		<div className="cc-ui-msg cc-ui-msg-user">
			<div className="cc-ui-msg-body">
				{text}
				{renderImages(message.content, setLightboxSrc)}
			</div>
			{actions && actions.length > 0 && <MessageActionsBar message={message as never} actions={actions} />}
			{lightboxSrc && <ImageLightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />}
		</div>
	);
}

function extractText(content: string | (TextContent | ImageContent)[]): string {
	if (typeof content === "string") return content;
	return content
		.filter((c): c is TextContent => c.type === "text")
		.map((c) => c.text)
		.join("\n");
}

function renderImages(
	content: string | (TextContent | ImageContent)[],
	onOpen: (src: string) => void,
): React.ReactNode {
	if (typeof content === "string") return null;
	const images = content.filter((c): c is ImageContent => c.type === "image");
	if (images.length === 0) return null;
	return (
		<div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", marginTop: "0.5rem" }}>
			{images.map((img, idx) => {
				const src = `data:${img.mimeType};base64,${img.data}`;
				return (
					<img
						key={idx}
						src={src}
						alt="attachment"
						onClick={() => onOpen(src)}
						style={{ maxWidth: "10rem", borderRadius: "0.4rem", cursor: "zoom-in" }}
					/>
				);
			})}
		</div>
	);
}
