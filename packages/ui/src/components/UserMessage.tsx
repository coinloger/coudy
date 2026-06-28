import type { UserMessage as UserMessageType } from "@coudycode/ai";
import type { ImageContent, TextContent } from "@coudycode/ai";
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
	return (
		<div className="cc-ui-msg cc-ui-msg-user">
			<div className="cc-ui-msg-body">
				{text}
				{renderImages(message.content)}
			</div>
			{actions && actions.length > 0 && <MessageActionsBar message={message as never} actions={actions} />}
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

function renderImages(content: string | (TextContent | ImageContent)[]): React.ReactNode {
	if (typeof content === "string") return null;
	const images = content.filter((c): c is ImageContent => c.type === "image");
	if (images.length === 0) return null;
	return (
		<div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", marginTop: "0.5rem" }}>
			{images.map((img, idx) => (
				<img
					key={idx}
					src={`data:${img.mimeType};base64,${img.data}`}
					alt="attachment"
					style={{ maxWidth: "10rem", borderRadius: "0.4rem" }}
				/>
			))}
		</div>
	);
}
