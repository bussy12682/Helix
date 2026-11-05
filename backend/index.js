import http from "node:http";
import { existsSync } from "node:fs";

import { createApp } from "./app.js";
import { createNodeHandler } from "./http-adapter.js";
import { loadConfig } from "./config.js";

const envFile = existsSync(".env.local") ? ".env.local" : ".env";
if (typeof process.loadEnvFile === "function" && existsSync(envFile)) {
  process.loadEnvFile(envFile);
}

const config = loadConfig(process.env);
const app = createApp({ env: process.env });

const server = http.createServer(createNodeHandler(app));
server.requestTimeout = 0; // SSE connections are long-lived

server.listen(config.appPort, () => {
  console.log(`HELIX backend listening on http://localhost:${config.appPort}`);
  const resumed = app.ai.orchestrator.resumeInterrupted?.() ?? [];
  if (resumed.length) console.log(`Resumed ${resumed.length} interrupted workflow(s).`);
});

function shutdown(signal) {
  console.log(`${signal} received, flushing state and shutting down.`);
  app.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
