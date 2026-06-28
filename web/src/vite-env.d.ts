/// <reference types="vite/client" />

import type React from "react";
import type { PluginChatCanvasProps } from "./PluginChatCanvas";
import type { PanelProps, CardProps } from "./PluginLayout";

/** Глобальний API для плагінів (TSX): React + reusable-компоненти. */
declare global {
	interface Window {
		React: typeof React;
		coudy: {
			React: typeof React;
			PluginChatCanvas: (props: PluginChatCanvasProps) => React.ReactNode;
			Panel: (props: PanelProps) => React.ReactNode;
			Card: (props: CardProps) => React.ReactNode;
		};
	}
}

export {};
