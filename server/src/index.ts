/**
 * Точка входу бекенду coudycode.
 * Створює власний екземпляр HookEngine (через CoudyServer),
 * завантажує плагіни та стартує HTTP-сервер.
 */

import { resolve } from "node:path";
import { CoudyServer } from "./server.js";

const projectRoot = resolve(import.meta.dirname, "../..");
const pluginsDir = resolve(projectRoot, "plugins");
const PORT = Number(process.env.PORT ?? 3001);

const server = new CoudyServer({ port: PORT, pluginsDir });

let stopping = false;
async function shutdown(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  console.log(`\n[coudycode] Отримано ${signal}, зупиняю сервер...`);
  try {
    await server.stop();
    process.exit(0);
  } catch (err) {
    console.error("[coudycode] Помилка при зупинці:", err);
    process.exit(1);
  }
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

server.start().catch(err => {
  console.error("[coudycode] Не вдалося запустити сервер:", err);
  process.exit(1);
});
