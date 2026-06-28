import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Дев-сервер: проксуємо /api та /plugins на бекенд, щоб уникати CORS.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": { target: "http://localhost:3001", changeOrigin: true },
      "/plugins": {
        target: "http://localhost:3001",
        changeOrigin: true,
        // Проксувати лише файли плагінів (/plugins/<name>/<path>). Bare SPA-роут
        // /plugins (Plugin Manager) при refresh — обслужити як index.html (SPA).
        bypass: (req) => {
          const url = req.url ?? "";
          const pathname = url.split("?")[0] ?? url;
          if (/^\/plugins\/[^/]+\/.+/.test(pathname)) return undefined; // проксирувати
          return "/index.html"; // SPA-роут → Vite сервить index.html
        },
      },
    },
  },
});
