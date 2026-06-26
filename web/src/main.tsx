import React from "react";
import { createRoot } from "react-dom/client";
import "bootstrap/dist/css/bootstrap.min.css";
import "./index.css";
import App from "./App";

// Експонуємо React глобально: плагіни (окремі бандли) можуть рендерити UI
// через window.React.createElement без власної копії React.
(window as unknown as { React: typeof React }).React = React;

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("Елемент #root не знайдено");

createRoot(rootEl).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
