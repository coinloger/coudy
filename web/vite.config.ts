import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Дев-сервер: проксуємо /api та /plugins на бекенд, щоб уникати CORS.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": { target: "http://localhost:3001", changeOrigin: true },
      "/plugins": { target: "http://localhost:3001", changeOrigin: true },
    },
  },
});
