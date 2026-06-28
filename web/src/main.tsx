import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "bootstrap/dist/css/bootstrap.min.css";
import "@coudycode/ui/styles.css";
import "./index.css";
import App from "./App";
import PluginChatCanvas from "./PluginChatCanvas";

// Експонуємо React + reusable-компоненти глобально: плагіни (окремі бандли, TSX через
// esbuild) можуть рендерити UI через window.React / window.coudy.PluginChatCanvas
// без власної копії React та без імпорту з app-бандла.
window.React = React;
window.coudy = { React, PluginChatCanvas };

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("Елемент #root не знайдено");

createRoot(rootEl).render(
  <BrowserRouter>
    <App />
  </BrowserRouter>,
);
