/**
 * Reliability tests: durable execution-job records, interrupted-work recovery
 * on boot, honest health readiness, and structured (redacted) logging.
 *
 * The file-store restart tests simulate a crashed process by persisting
 * mid-flight records, then booting a FRESH app instance over the same state —
 * exactly what happens after a real crash. The PostgreSQL variant runs only
 * when HELIX_PG_TEST_URL points at a real server.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { createApp } from "../app.js";
import { createLogger, redact } from "../logger.js";
import { makeApp, call, signUp, createProject } from "./helpers.js";

test("interrupted execution jobs are finalized honestly on boot recovery", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "helix-recovery-"));
  const storagePath = path.join(dir, "state.json");
  tCleanup(dir);

  // First life: a job mid-flight when the process "crashes".
  const first = createApp({ storagePath, env: {} });
  await first.ready;
  first.store.saveExecutionJob({
    id: "exec_interrupted_1",
    projectId: "project_x",
    kind: "command",
    command: ["node", "-e", "while(true){}"],
    timeoutMs: 30000,
    testSuiteName: null,
    allowNetwork: false,
    env: {},
    status: "running",
    createdAt: new Date().toISOString(),
    startedAt: new Date().toISOString(),
    completedAt: null,
    stopRequested: false,
    outputTruncated: false,
    stdout: "",
    stderr: "",
    result: null,
  });
  first.store.flush();

  // Second life: recovery must finalize the orphan, never resurrect it.
  const second = createApp({ storagePath, env: {} });
  await second.ready;
  assert.equal(second.recovery.interruptedExecutionJobs, 1);
  const job = second.execution.getJob("project_x", "exec_interrupted_1");
  assert.ok(job, "hydrated job record must be queryable after restart");
  assert.equal(job.status, "interrupted");
  assert.ok(job.completedAt, "an interrupted job must be finalized with completedAt");
  assert.equal(job.result.status, "INTERRUPTED");
  assert.match(job.result.error, /interrupted by backend restart/);
  assert.equal(second.recovery.interruptedPipelineRuns, 0);

  // History stays visible through the service API.
  const listed = second.execution.listJobs("project_x");
  assert.equal(listed.find((entry) => entry.id === "exec_interrupted_1")?.status, "interrupted");

  // The recovered state is itself durable (a second restart sees it completed).
  second.store.flush();
  const third = createApp({ storagePath, env: {} });
  await third.ready;
  assert.equal(
    third.recovery.interruptedExecutionJobs,
    0,
    "already-recovered jobs must not be double-counted",
  );
  assert.equal(third.execution.getJob("project_x", "exec_interrupted_1").status, "interrupted");
  await second.close();
  await third.close();
});

test("interrupted autonomous runs are marked interrupted and history survives restarts", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "helix-runs-"));
  const storagePath = path.join(dir, "state.json");
  tCleanup(dir);

  const first = createApp({ storagePath, env: {} });
  await first.ready;
  first.store.savePipelineRun({
    id: "run_interrupted_1",
    projectId: "project_y",
    status: "running",
    startedAt: new Date().toISOString(),
    finishedAt: null,
    error: null,
    verified: null,
    options: { regenerate: true, install: true, test: true, build: true, repairRounds: 2 },
    steps: [
      { kind: "generate", title: "Generation", status: "completed", verified: null, jobId: null },
      { kind: "test", title: "Tests", status: "running", verified: null, jobId: "exec_z" },
    ],
  });
  first.store.flush();

  const second = createApp({ storagePath, env: {} });
  await second.ready;
  assert.equal(second.recovery.interruptedPipelineRuns, 1);
  const run = second.pipeline.getRun("project_y", "run_interrupted_1");
  assert.ok(run, "hydrated run record must be queryable after restart");
  assert.equal(run.status, "interrupted");
  assert.ok(run.finishedAt);
  assert.match(run.error, /interrupted by backend restart/);
  assert.equal(run.steps.length, 2, "step history must survive the restart");
  await second.close();
});

test("completed execution jobs persist and are queryable across a restart", async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), "helix-jobs-"));
  const storagePath = path.join(dir, "state.json");
  tCleanup(dir);

  const first = createApp({ storagePath, env: { HELIX_MOCK_AI: "true" } });
  await first.ready;
  const sandbox = await first.execution.getStatus();
  if (!sandbox.available) {
    await first.close();
    t.skip(`sandboxed execution unavailable here: ${sandbox.reason}`);
    return;
  }
  const { token } = await signUp(first, `reliability-${crypto.randomUUID()}@example.com`);
  const project = await createProject(first, token, "Reliability Project");
  // Start a real sandboxed job that fails fast (node with a thrown error).
  const job = first.execution.start(project.id, {
    command: ["node", "-e", "throw new Error('boom')"],
    kind: "command",
    timeoutMs: 15000,
  });
  await job.completion;
  await first.close();

  const second = createApp({ storagePath, env: { HELIX_MOCK_AI: "true" } });
  await second.ready;
  const restored = second.execution.listJobs(project.id).find((entry) => entry.id === job.id);
  assert.ok(restored, "the completed job must be visible after a restart");
  assert.equal(restored.status, "failed");
  assert.equal(restored.result.exitCode, 1);
  assert.match(restored.result.stderr, /boom/);
  assert.equal(second.recovery.interruptedExecutionJobs, 0);
  await second.close();
});

test("health endpoint reports honest readiness: storage, execution, providers, recovery", async () => {
  const { app } = makeApp();
  await app.ready;
  const response = await app.request("http://localhost/api/v1/health");
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.service, "helix-core");
  assert.equal(body.status, "healthy");
  assert.equal(body.storage, "memory");
  assert.ok(typeof body.ai?.mode === "string");

  const readiness = body.readiness;
  assert.ok(readiness, "readiness detail must be present");
  assert.equal(readiness.storage.mode, "memory");
  assert.equal(readiness.providers.mode, body.ai.mode);
  assert.ok(
    typeof readiness.execution.available === "boolean" || readiness.execution.available === null,
  );
  assert.ok(typeof readiness.execution.maxConcurrent === "number");
  assert.ok(readiness.recovery, "boot recovery summary must be present");
  assert.ok(Number.isFinite(body.uptimeSeconds));
});

test("health flags degraded storage when writes fail or backlog exists", async () => {
  const { app } = makeApp();
  await app.ready;
  // Simulate a store with an unresolved write backlog / failure surfaced.
  app.store.getStatus = () => ({
    mode: "postgres",
    pendingWrites: 3,
    lastWriteError: "ERROR: connection refused",
  });
  const response = await app.request("http://localhost/api/v1/health");
  const body = await response.json();
  assert.equal(body.ok, true, "the process can still serve traffic");
  assert.equal(body.status, "degraded");
  assert.equal(body.readiness.storage.lastWriteError, "ERROR: connection refused");
  assert.equal(body.readiness.storage.pendingWrites, 3);
});

test("structured logger emits JSON lines and redacts secrets", () => {
  const lines = [];
  const sink = { write: (line) => lines.push(line) };
  const logger = createLogger({ component: "test", level: "info", sink });

  logger.info("request completed", {
    requestId: "req_1",
    authorization: "Bearer super-secret",
    password: "hunter2",
    apiKey: "sk-live-123",
    nested: { sessionToken: "abc", keep: "me" },
    status: 200,
  });
  logger.debug("must be suppressed below the info threshold", {});

  const logger2 = createLogger({ component: "test2", level: "debug", sink });
  logger2.debug("visible", { n: 1 });

  assert.equal(lines.length, 2);
  const entry = JSON.parse(lines[0]);
  assert.equal(entry.component, "test");
  assert.equal(entry.msg, "request completed");
  assert.equal(entry.status, 200);
  assert.equal(entry.authorization, "[redacted]");
  assert.equal(entry.password, "[redacted]");
  assert.equal(entry.apiKey, "[redacted]");
  assert.equal(entry.nested.sessionToken, "[redacted]");
  assert.equal(entry.nested.keep, "me");
  assert.ok(entry.time);

  assert.deepEqual(redact({ apiToken: "x", deep: { list: [{ userPassword: "y", ok: 1 }] } }), {
    apiToken: "[redacted]",
    deep: { list: [{ userPassword: "[redacted]", ok: 1 }] },
  });
});

test("requests are logged as structured JSON with redaction", async () => {
  const lines = [];
  const app = createApp({
    storagePath: ":memory:",
    ai: (await import("../ai/index.js")).createAiSubsystem({ mockMode: true }),
    logger: createLogger({
      component: "api",
      level: "info",
      sink: { write: (l) => lines.push(l) },
    }),
    env: {},
  });
  await app.ready;
  const response = await app.request("http://localhost/api/v1/nope");
  assert.equal(response.status, 404);
  const entry = lines.map((line) => JSON.parse(line)).find((e) => e.msg === "request");
  assert.ok(entry, "a request log line must be emitted");
  assert.equal(entry.method, "GET");
  assert.equal(entry.path, "/api/v1/nope");
  assert.equal(entry.status, 404);
  assert.ok(Number.isFinite(entry.durationMs));
  assert.ok(entry.requestId);
});

const pgUrl = process.env.HELIX_PG_TEST_URL ?? "";
const pgOptions = {
  skip: pgUrl ? false : "set HELIX_PG_TEST_URL to run the PostgreSQL recovery test",
};

test(
  "PostgreSQL: interrupted jobs and runs are recovered from durable records on boot",
  pgOptions,
  async (t) => {
    const { provisionDatabase } = await import("./postgres-store-helpers.js");
    const db = await provisionDatabase(pgUrl);
    const dir = mkdtempSync(path.join(tmpdir(), "helix-pg-recovery-"));
    tCleanup(dir);
    t.after(async () => {
      await db.dispose();
      rmSync(dir, { recursive: true, force: true });
    });

    // First life: durable records land in PostgreSQL via the write-through store.
    const first = createApp({
      storagePath: ":memory:",
      env: { DATABASE_URL: db.url, HELIX_MOCK_AI: "true", HELIX_WORKSPACE_ROOT: dir },
    });
    await first.ready;
    const { token } = await signUp(first, `pg-recovery-${crypto.randomUUID()}@example.com`);
    const project = await createProject(first, token, "PG Recovery");
    const job = first.execution.start(project.id, {
      command: ["node", "-e", "process.exit(0)"],
      kind: "command",
      timeoutMs: 15000,
    });
    await job.completion;
    await first.store.flush();
    const jobsInPg = await db.query("SELECT count(*)::int AS n FROM execution_jobs WHERE id = $1", [
      job.id,
    ]);
    assert.equal(jobsInPg.rows[0].n, 1, "the job record must be durable in PostgreSQL");
    await first.close();

    // Simulate a crash mid-flight by writing a running job + run directly.
    const crashTime = new Date().toISOString();
    await db.query(
      "INSERT INTO execution_jobs (id, project_id, status, created_at, doc) VALUES ($1, $2, 'running', $3, $4)",
      [
        "exec_pg_crash",
        project.id,
        crashTime,
        JSON.stringify({
          id: "exec_pg_crash",
          projectId: project.id,
          kind: "command",
          command: ["node", "-e", "1"],
          timeoutMs: 1000,
          testSuiteName: null,
          allowNetwork: false,
          env: {},
          status: "running",
          createdAt: crashTime,
          startedAt: crashTime,
          completedAt: null,
          stopRequested: false,
          outputTruncated: false,
          stdout: "",
          stderr: "",
          result: null,
        }),
      ],
    );
    await db.query(
      "INSERT INTO pipeline_runs (id, project_id, status, started_at, doc) VALUES ($1, $2, 'running', $3, $4)",
      [
        "run_pg_crash",
        project.id,
        crashTime,
        JSON.stringify({
          id: "run_pg_crash",
          projectId: project.id,
          status: "running",
          startedAt: crashTime,
          finishedAt: null,
          error: null,
          verified: null,
          options: {},
          steps: [],
        }),
      ],
    );

    // Second life on the same database: hydration + recovery before serving.
    const second = createApp({
      storagePath: ":memory:",
      env: { DATABASE_URL: db.url, HELIX_MOCK_AI: "true", HELIX_WORKSPACE_ROOT: dir },
    });
    await second.ready;
    assert.equal(second.recovery.interruptedExecutionJobs, 1);
    assert.equal(second.recovery.interruptedPipelineRuns, 1);
    assert.equal(second.execution.getJob(project.id, "exec_pg_crash").status, "interrupted");
    assert.equal(second.pipeline.getRun(project.id, "run_pg_crash").status, "interrupted");
    const restored = second.execution.listJobs(project.id).find((entry) => entry.id === job.id);
    assert.ok(restored, "pre-crash completed job history must be queryable");
    await second.close();
  },
);

function tCleanup(dir) {
  process.on("exit", () => {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  });
}
