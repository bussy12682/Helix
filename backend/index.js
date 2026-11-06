import http from "node:http";
import { existsSync } from "node:fs";

import { createApp } from "./app.js";
import { createNodeHandler } from "./http-adapter.js";
import { loadConfig } from "./config.js";
import { createLogger } from "./logger.js";

const envFile = existsSync(".env.local") ? ".env.local" : ".env";
if (typeof process.loadEnvFile === "function" && existsSync(envFile)) {
  process.loadEnvFile(envFile);
}

const config = loadConfig(process.env);
const logger = createLogger({ component: "server", level: config.logLevel });
const app = createApp({ env: process.env, logger: logger.child({ component: "api" }) });

const server = http.createServer(createNodeHandler(app));
server.requestTimeout = 0; // SSE connections are long-lived

function shutdown(signal) {
  logger.info("shutdown signal received", { signal });
  const draining = Promise.resolve(app.close());
  server.close(() => process.exit(0));
  draining.then(() => process.exit(0)).catch(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

// Persistent stores (PostgreSQL) hydrate asynchronously: accept connections only
// after migrations, the advisory lock, state recovery, and interrupted-job
// finalization complete.
app.ready
  .then(() => {
    server.listen(config.appPort, () => {
      const status = typeof app.getStatus === "function" ? app.getStatus() : null;
      logger.info("helix backend listening", {
        port: config.appPort,
        environment: config.nodeEnv,
        storage: status?.mode ?? "memory",
        migrations: status?.migrations ?? [],
      });
      if (
        app.recovery &&
        (app.recovery.interruptedExecutionJobs || app.recovery.interruptedPipelineRuns)
      ) {
        logger.warn("recovered interrupted work before serving traffic", {
          interruptedExecutionJobs: app.recovery.interruptedExecutionJobs,
          interruptedPipelineRuns: app.recovery.interruptedPipelineRuns,
        });
      }
      const resumed = app.ai.orchestrator.resumeInterrupted?.() ?? [];
      if (resumed.length) logger.info("resumed interrupted workflows", { count: resumed.length });
    });
  })
  .catch((error) => {
    logger.error("storage initialization failed; refusing to start", { error: error.message });
    process.exit(1);
  });
