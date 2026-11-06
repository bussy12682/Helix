/**
 * HELIX AI Engineering Operating System — PostgreSQL Store
 *
 * Production persistence with the SAME synchronous API as the memory store:
 * a write-through durable cache. Every mutation is recorded in live Maps (the
 * existing call sites and tests are untouched) and flushed to PostgreSQL inside
 * a single transaction; boot hydrates the cache from PostgreSQL, so state —
 * users, sessions, projects, workflows, workspaces, traces, TASKFLOWs —
 * survives process crashes and restarts.
 *
 * Safety properties (each covered by tests when a database is available):
 *  - migrations run once, transactionally, under an advisory lock;
 *  - flushes are atomic (BEGIN/COMMIT, rollback on error, bounded retries on
 *    serialization failures 40001 / deadlock 40P01);
 *  - a process-lifetime advisory lock refuses a second HELIX instance on the
 *    same database (split-brain prevention);
 *  - expired sessions and password resets are purged on boot;
 *  - if a flush fails, the cache keeps the change and the error is surfaced
 *    through getStatus() and /health — writes are never silently dropped.
 *
 * Multi-writer scaling still requires single-writer-per-database deployment;
 * this layer makes the data durable and transactional, not multi-instance.
 */

import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "migrations");
const FLUSH_COALESCE_MS = 200;
const MAX_FLUSH_RETRIES = 3;
const SERIALIZATION_CODES = new Set(["40001", "40P01"]);

function loadMigrations() {
  try {
    return readdirSync(MIGRATIONS_DIR)
      .filter((name) => /^\d+_.*\.sql$/.test(name))
      .sort()
      .map((name) => ({
        version: Number(name.split("_")[0]),
        name,
        sql: readFileSync(join(MIGRATIONS_DIR, name), "utf8"),
      }));
  } catch {
    return [];
  }
}

function tableForKey(kind, key) {
  // Returns the physical table and its key column for a tracked record.
  const tables = {
    users: "users",
    sessions: "sessions",
    projects: "projects",
    passwordResets: "password_resets",
    workflows: "workflows",
    workspaces: "workspaces",
    traces: "traces",
    taskflows: "taskflows",
    executionJobs: "execution_jobs",
    pipelineRuns: "pipeline_runs",
    budgetUsage: "budget_usage",
    auditEvents: "audit_events",
  };
  const keyColumns = {
    executionJobs: "id",
    pipelineRuns: "id",
    budgetUsage: "scope_key",
    auditEvents: "id",
  };
  return {
    table: tables[kind],
    keyColumn:
      keyColumns[kind] ??
      (kind === "workspaces"
        ? "project_id"
        : kind === "traces"
          ? "workflow_id"
          : kind === "passwordResets"
            ? "token"
            : kind === "sessions"
              ? "token"
              : "id"),
    key,
  };
}

export function createPostgresStore({ connectionString, poolSize = 10, logger = console } = {}) {
  if (!connectionString)
    throw new Error("createPostgresStore requires a PostgreSQL connection string");

  const users = new Map();
  const sessions = new Map();
  const projects = new Map();
  const passwordResets = new Map();
  const workflows = new Map();
  const workspaces = new Map();
  const traces = new Map();
  const taskflows = new Map();
  const executionJobs = new Map();
  const pipelineRuns = new Map();
  const budgetUsage = new Map();
  const auditEvents = new Map();

  const dirty = new Map(); // `${kind}:${key}` -> { kind, key, action: "upsert" | "delete" }
  const state = {
    migrations: [],
    lastWriteError: null,
    lastWriteAt: null,
    flushedWrites: 0,
    advisoryLockHeld: false,
    closed: false,
  };

  let pool = null;
  let lockClient = null;
  let flushTimer = null;
  let flushChain = Promise.resolve();

  function sslConfig() {
    const url = new URL(connectionString);
    const sslmode = url.searchParams.get("sslmode") ?? url.searchParams.get("ssl");
    if (sslmode === "require" || sslmode === "prefer")
      return { ssl: { rejectUnauthorized: false } };
    if (sslmode === "no-verify" || sslmode === "disable")
      return sslmode === "disable" ? {} : { ssl: { rejectUnauthorized: false } };
    return {};
  }

  async function withTransaction(fn, { retries = MAX_FLUSH_RETRIES } = {}) {
    let attempt = 0;
    for (;;) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await fn(client);
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        attempt += 1;
        const retryable = SERIALIZATION_CODES.has(error.code);
        if (retryable && attempt <= retries) {
          await new Promise((resolve) => setTimeout(resolve, 25 * 2 ** attempt));
          continue;
        }
        throw error;
      } finally {
        client.release();
      }
    }
  }

  async function migrate() {
    const migrations = loadMigrations();
    await withTransaction(async (client) => {
      await client.query("SELECT pg_advisory_xact_lock(918273645)");
      await client.query(
        "CREATE TABLE IF NOT EXISTS helix_migrations (version integer PRIMARY KEY, name text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())",
      );
      const { rows } = await client.query("SELECT version FROM helix_migrations");
      const applied = new Set(rows.map((row) => row.version));
      for (const migration of migrations) {
        if (applied.has(migration.version)) continue;
        await client.query(migration.sql);
        await client.query("INSERT INTO helix_migrations (version, name) VALUES ($1, $2)", [
          migration.version,
          migration.name,
        ]);
        state.migrations.push(migration.name);
      }
    });
    if (!state.migrations.length) {
      const { rows } = await pool.query("SELECT name FROM helix_migrations ORDER BY version");
      state.migrations = rows.map((row) => row.name);
    }
  }

  function upsertSql(kind, value) {
    switch (kind) {
      case "users":
        return {
          sql: "INSERT INTO users (id, email, doc, updated_at) VALUES ($1, $2, $3::jsonb, now()) ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, doc = EXCLUDED.doc, updated_at = now()",
          params: [value.id, value.email, JSON.stringify(value)],
        };
      case "sessions":
        return {
          sql: "INSERT INTO sessions (token, user_id, expires_at, doc) VALUES ($1, $2, $3, $4::jsonb) ON CONFLICT (token) DO UPDATE SET doc = EXCLUDED.doc, expires_at = EXCLUDED.expires_at",
          params: [value.token, value.userId, value.expiresAt, JSON.stringify(value)],
        };
      case "projects":
        return {
          sql: "INSERT INTO projects (id, owner_id, doc, updated_at) VALUES ($1, $2, $3::jsonb, now()) ON CONFLICT (id) DO UPDATE SET doc = EXCLUDED.doc, updated_at = now()",
          params: [value.id, value.ownerId, JSON.stringify(value)],
        };
      case "passwordResets":
        return {
          sql: "INSERT INTO password_resets (token, expires_at, doc) VALUES ($1, $2, $3::jsonb) ON CONFLICT (token) DO UPDATE SET doc = EXCLUDED.doc, expires_at = EXCLUDED.expires_at",
          params: [
            value.token,
            value.expiresAt ?? new Date(Date.now() + 3600_000).toISOString(),
            JSON.stringify(value),
          ],
        };
      case "workflows":
        return {
          sql: "INSERT INTO workflows (id, project_id, doc, updated_at) VALUES ($1, $2, $3::jsonb, now()) ON CONFLICT (id) DO UPDATE SET doc = EXCLUDED.doc, updated_at = now()",
          params: [value.id, value.projectId, JSON.stringify(value)],
        };
      case "workspaces": {
        const artifacts =
          value.artifacts instanceof Map ? [...value.artifacts.values()] : (value.artifacts ?? []);
        return {
          sql: "INSERT INTO workspaces (project_id, doc, updated_at) VALUES ($1, $2::jsonb, now()) ON CONFLICT (project_id) DO UPDATE SET doc = EXCLUDED.doc, updated_at = now()",
          params: [value.projectId, JSON.stringify({ ...value, artifacts })],
        };
      }
      case "traces":
        return {
          sql: "INSERT INTO traces (workflow_id, spans) VALUES ($1, $2::jsonb) ON CONFLICT (workflow_id) DO UPDATE SET spans = EXCLUDED.spans",
          params: [value.workflowId, JSON.stringify(value.spans ?? [])],
        };
      case "taskflows":
        return {
          sql: "INSERT INTO taskflows (id, project_id, doc, updated_at) VALUES ($1, $2, $3::jsonb, now()) ON CONFLICT (id) DO UPDATE SET doc = EXCLUDED.doc, updated_at = now()",
          params: [value.id, value.projectId, JSON.stringify(value)],
        };
      case "executionJobs":
        return {
          sql: "INSERT INTO execution_jobs (id, project_id, status, created_at, completed_at, doc, updated_at) VALUES ($1, $2, $3, $4, $5, $6::jsonb, now()) ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, completed_at = EXCLUDED.completed_at, doc = EXCLUDED.doc, updated_at = now()",
          params: [
            value.id,
            value.projectId,
            value.status,
            value.createdAt,
            value.completedAt ?? null,
            JSON.stringify(value),
          ],
        };
      case "pipelineRuns":
        return {
          sql: "INSERT INTO pipeline_runs (id, project_id, status, started_at, doc, updated_at) VALUES ($1, $2, $3, $4, $5::jsonb, now()) ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, doc = EXCLUDED.doc, updated_at = now()",
          params: [value.id, value.projectId, value.status, value.startedAt, JSON.stringify(value)],
        };
      case "budgetUsage":
        return {
          sql: "INSERT INTO budget_usage (scope_key, doc, updated_at) VALUES ($1, $2::jsonb, now()) ON CONFLICT (scope_key) DO UPDATE SET doc = EXCLUDED.doc, updated_at = now()",
          params: [value.key ?? value.scopeKey ?? key, JSON.stringify(value)],
        };
      case "auditEvents":
        return {
          sql: "INSERT INTO audit_events (id, user_id, project_id, type, created_at, doc) VALUES ($1, $2, $3, $4, $5, $6::jsonb) ON CONFLICT (id) DO UPDATE SET doc = EXCLUDED.doc",
          params: [
            value.id,
            value.userId,
            value.projectId,
            value.type,
            value.createdAt,
            JSON.stringify(value),
          ],
        };
      default:
        throw new Error(`Unknown entity kind: ${kind}`);
    }
  }

  function valueFor(kind, key) {
    switch (kind) {
      case "users":
        return users.get(key);
      case "sessions":
        return sessions.get(key);
      case "projects":
        return projects.get(key);
      case "passwordResets":
        return passwordResets.get(key);
      case "workflows":
        return workflows.get(key);
      case "workspaces":
        return workspaces.get(key);
      case "traces":
        return { workflowId: key, spans: traces.get(key) ?? [] };
      case "taskflows":
        return taskflows.get(key);
      case "executionJobs":
        return executionJobs.get(key);
      case "pipelineRuns":
        return pipelineRuns.get(key);
      case "budgetUsage":
        return budgetUsage.get(key);
      case "auditEvents":
        return auditEvents.get(key);
      default:
        return null;
    }
  }

  async function flushToPostgres() {
    if (state.closed || !dirty.size) return;
    const batch = [...dirty.values()];
    dirty.clear();
    try {
      await withTransaction(async (client) => {
        for (const entry of batch) {
          const { table, keyColumn, key } = tableForKey(entry.kind, entry.key);
          if (entry.action === "delete") {
            await client.query(`DELETE FROM ${table} WHERE ${keyColumn} = $1`, [key]);
            continue;
          }
          const value = valueFor(entry.kind, entry.key);
          if (value === null || value === undefined) continue; // deleted later in the same batch
          const { sql, params } = upsertSql(entry.kind, value);
          await client.query(sql, params);
        }
      });
      state.flushedWrites += batch.length;
      state.lastWriteAt = new Date().toISOString();
      state.lastWriteError = null;
    } catch (error) {
      // Keep the records dirty so the next flush retries; never drop writes silently.
      for (const entry of batch) dirty.set(`${entry.kind}:${entry.key}`, entry);
      state.lastWriteError = `${error.code ?? "ERROR"}: ${error.message}`;
      logger.error("[postgres-store] flush failed; writes remain queued:", state.lastWriteError);
    }
  }

  function persist() {
    for (const [key, value] of users)
      dirty.set(`users:${key}`, { kind: "users", key, action: "upsert" });
    markAll();
    scheduleFlush(true);
  }

  function mark(kind, key, action = "upsert") {
    dirty.set(`${kind}:${key}`, { kind, key, action });
  }

  function markAll() {
    for (const [key] of sessions) mark("sessions", key);
    for (const [key] of projects) mark("projects", key);
    for (const [key] of passwordResets) mark("passwordResets", key);
    for (const [key] of workflows) mark("workflows", key);
    for (const [key] of workspaces) mark("workspaces", key);
    for (const [key] of traces) mark("traces", key);
    for (const [key] of taskflows) mark("taskflows", key);
    for (const [key] of executionJobs) mark("executionJobs", key);
    for (const [key] of pipelineRuns) mark("pipelineRuns", key);
    for (const [key] of budgetUsage) mark("budgetUsage", key);
    for (const [key] of auditEvents) mark("auditEvents", key);
  }

  function scheduleFlush(immediate = false) {
    if (state.closed) return;
    if (immediate) {
      // Coalesce bursts but do not drop the flush if a timer already waits.
      if (!flushTimer) {
        flushTimer = setTimeout(() => {
          flushTimer = null;
          flushChain = flushChain.then(() => flushToPostgres()).catch(() => {});
        }, FLUSH_COALESCE_MS);
        flushTimer.unref?.();
      }
      return;
    }
    if (!flushTimer) {
      flushTimer = setTimeout(() => {
        flushTimer = null;
        flushChain = flushChain.then(() => flushToPostgres()).catch(() => {});
      }, FLUSH_COALESCE_MS);
      flushTimer.unref?.();
    }
  }

  function persistSoon(delayMs = FLUSH_COALESCE_MS) {
    scheduleFlush(false);
  }

  async function hydrate() {
    const [
      userRows,
      sessionRows,
      projectRows,
      resetRows,
      workflowRows,
      workspaceRows,
      traceRows,
      taskflowRows,
      jobRows,
      runRows,
      budgetRows,
      auditRows,
    ] = await Promise.all([
      pool.query("SELECT doc FROM users"),
      pool.query("SELECT doc FROM sessions WHERE expires_at > now()"),
      pool.query("SELECT doc FROM projects"),
      pool.query("SELECT doc FROM password_resets WHERE expires_at > now()"),
      pool.query("SELECT doc FROM workflows"),
      pool.query("SELECT doc FROM workspaces"),
      pool.query("SELECT workflow_id, spans FROM traces"),
      pool.query("SELECT doc FROM taskflows"),
      pool.query("SELECT doc FROM execution_jobs"),
      pool.query("SELECT doc FROM pipeline_runs"),
      pool.query("SELECT scope_key, doc FROM budget_usage"),
      pool.query("SELECT doc FROM audit_events"),
    ]);
    for (const row of userRows.rows) users.set(row.doc.id, row.doc);
    for (const row of sessionRows.rows) sessions.set(row.doc.token, row.doc);
    for (const row of projectRows.rows) projects.set(row.doc.id, row.doc);
    for (const row of resetRows.rows) passwordResets.set(row.doc.token, row.doc);
    for (const row of workflowRows.rows) workflows.set(row.doc.id, row.doc);
    for (const row of workspaceRows.rows) {
      const { artifacts = [], ...rest } = row.doc ?? {};
      workspaces.set(row.doc.projectId, {
        ...rest,
        artifacts: new Map(artifacts.map((a) => [a.path, a])),
      });
    }
    for (const row of traceRows.rows) traces.set(row.workflow_id, row.spans ?? []);
    for (const row of taskflowRows.rows) taskflows.set(row.doc.id, row.doc);
    for (const row of jobRows.rows) executionJobs.set(row.doc.id, row.doc);
    for (const row of runRows.rows) pipelineRuns.set(row.doc.id, row.doc);
    for (const row of budgetRows.rows) budgetUsage.set(row.scope_key ?? row.doc.key, row.doc);
    for (const row of auditRows.rows) auditEvents.set(row.doc.id, row.doc);

    // Boot hygiene: purge expired credentials outright.
    await pool.query("DELETE FROM sessions WHERE expires_at <= now()");
    await pool.query("DELETE FROM password_resets WHERE expires_at <= now()");
  }

  async function acquireAdvisoryLock() {
    lockClient = await pool.connect();
    const { rows } = await lockClient.query("SELECT pg_try_advisory_lock(918273646) AS locked");
    if (!rows[0]?.locked) {
      lockClient.release();
      lockClient = null;
      throw new Error(
        "Another HELIX instance already holds this database (advisory lock 918273646). " +
          "Run exactly one API instance per database, or use separate databases.",
      );
    }
    state.advisoryLockHeld = true;
  }

  async function teardown() {
    state.closed = true;
    if (flushTimer) clearTimeout(flushTimer);
    if (lockClient) {
      await lockClient.query("SELECT pg_advisory_unlock(918273646)").catch(() => {});
      lockClient.release();
      lockClient = null;
      state.advisoryLockHeld = false;
    }
    if (pool) await pool.end().catch(() => {});
    pool = null;
  }

  const ready = (async () => {
    try {
      const pg = await import("pg").catch(() => {
        throw new Error(
          "DATABASE_URL is configured but the 'pg' driver is not installed. Run `npm install pg`.",
        );
      });
      pool = new pg.Pool({
        connectionString,
        max: poolSize,
        idleTimeoutMillis: 10_000,
        connectionTimeoutMillis: 10_000,
        ...sslConfig(),
      });
      pool.on("error", (error) =>
        logger.error("[postgres-store] idle client error:", error.message),
      );
      await acquireAdvisoryLock();
      await migrate();
      await hydrate();
      return store;
    } catch (error) {
      // Never leave sockets or locks behind on a failed boot.
      await teardown();
      throw error;
    }
  })();

  function nextId(prefix) {
    return `${prefix}_${randomUUID()}`;
  }

  function createUser({
    name,
    email,
    passwordHash,
    emailVerified = false,
    authProvider = "password",
  }) {
    const id = nextId("user");
    const user = {
      id,
      name,
      email: email.toLowerCase(),
      passwordHash,
      authProvider,
      emailVerified,
      emailVerificationToken: null,
      createdAt: new Date().toISOString(),
    };
    users.set(id, user);
    mark("users", id);
    scheduleFlush(true);
    return user;
  }

  function getUserByEmail(email) {
    const normalized = String(email ?? "")
      .trim()
      .toLowerCase();
    return [...users.values()].find((user) => user.email === normalized) ?? null;
  }

  function getUserById(id) {
    return users.get(id) ?? null;
  }

  function updateUser(id, patch) {
    const user = users.get(id);
    if (!user) return null;
    Object.assign(user, patch, { updatedAt: new Date().toISOString() });
    mark("users", id);
    scheduleFlush(true);
    return user;
  }

  function deleteSession(token) {
    const deleted = sessions.delete(token);
    if (deleted) {
      mark("sessions", token, "delete");
      scheduleFlush(true);
    }
    return deleted;
  }

  function deleteSessionsForUser(userId) {
    let count = 0;
    for (const [token, session] of sessions) {
      if (session.userId === userId) {
        sessions.delete(token);
        mark("sessions", token, "delete");
        count += 1;
      }
    }
    if (count) scheduleFlush(true);
    return count;
  }

  function createSession(userId, rememberMe = false) {
    const token = `helix.${randomUUID()}`;
    const expirationMs = rememberMe ? 1000 * 60 * 60 * 24 * 30 : 1000 * 60 * 60 * 8;
    const session = {
      id: nextId("session"),
      token,
      userId,
      rememberMe,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + expirationMs).toISOString(),
    };
    sessions.set(token, session);
    mark("sessions", token);
    scheduleFlush(true);
    return session;
  }

  function getSession(token) {
    const session = sessions.get(token) ?? null;
    if (!session) return null;
    if (new Date(session.expiresAt) < new Date()) {
      sessions.delete(token);
      mark("sessions", token, "delete");
      scheduleFlush(true);
      return null;
    }
    return session;
  }

  function validateSessionExpiration(token) {
    const session = sessions.get(token);
    if (!session) return { isValid: false, expired: true };
    const isExpired = new Date(session.expiresAt) < new Date();
    if (isExpired) {
      sessions.delete(token);
      mark("sessions", token, "delete");
      scheduleFlush(true);
    }
    return {
      isValid: !isExpired,
      expired: isExpired,
      expiresAt: session.expiresAt,
      rememberMe: session.rememberMe,
    };
  }

  function createProject({ ownerId, name, description = "", keyFeatures = [], techStack = [] }) {
    const id = nextId("project");
    const project = {
      id,
      ownerId,
      name,
      description,
      keyFeatures,
      techStack,
      status: "active",
      progress: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    projects.set(id, project);
    mark("projects", id);
    scheduleFlush(true);
    return project;
  }

  function getProjectById(id) {
    return projects.get(id) ?? null;
  }

  function updateProject(id, patch) {
    const project = projects.get(id);
    if (!project) return null;
    Object.assign(project, patch, { updatedAt: new Date().toISOString() });
    mark("projects", id);
    scheduleFlush(true);
    return project;
  }

  function deleteProject(id) {
    const deleted = projects.delete(id);
    if (deleted) {
      mark("projects", id, "delete");
      for (const [workflowId, workflow] of workflows) {
        if (workflow.projectId === id) {
          workflows.delete(workflowId);
          mark("workflows", workflowId, "delete");
          traces.delete(workflowId);
          mark("traces", workflowId, "delete");
        }
      }
      workspaces.delete(id);
      mark("workspaces", id, "delete");
      for (const [planId, plan] of taskflows) {
        if (plan.projectId === id) {
          taskflows.delete(planId);
          mark("taskflows", planId, "delete");
        }
      }
      scheduleFlush(true);
    }
    return deleted;
  }

  function saveWorkflow(workflow) {
    workflows.set(workflow.id, workflow);
    mark("workflows", workflow.id);
    scheduleFlush(true);
    return workflow;
  }

  function listWorkflows() {
    return [...workflows.values()];
  }

  function serializeWorkspace(workspace) {
    return { ...workspace, artifacts: [...workspace.artifacts.values()] };
  }

  function saveWorkspace(workspace) {
    workspaces.set(workspace.projectId, workspace);
    mark("workspaces", workspace.projectId);
    scheduleFlush(true);
    return workspace;
  }

  function listWorkspaces() {
    return [...workspaces.values()].map((ws) => serializeWorkspace(ws));
  }

  function saveTrace(span) {
    const existing = traces.get(span.workflowId) ?? [];
    const index = existing.findIndex((entry) => entry.spanId === span.spanId);
    if (index >= 0) existing[index] = span;
    else existing.push(span);
    traces.set(span.workflowId, existing);
    mark("traces", span.workflowId);
    scheduleFlush(false);
    return span;
  }

  function listTraces() {
    return [...traces.entries()].map(([workflowId, spans]) => ({ workflowId, spans }));
  }

  function saveTaskflow(plan) {
    taskflows.set(plan.id, plan);
    mark("taskflows", plan.id);
    scheduleFlush(true);
    return plan;
  }

  function listTaskflows() {
    return [...taskflows.values()];
  }

  function saveExecutionJob(job) {
    executionJobs.set(job.id, job);
    mark("executionJobs", job.id);
    scheduleFlush(true);
    return job;
  }

  function deleteExecutionJob(id) {
    const deleted = executionJobs.delete(id);
    if (deleted) {
      mark("executionJobs", id, "delete");
      scheduleFlush(true);
    }
    return deleted;
  }

  function listExecutionJobs() {
    return [...executionJobs.values()];
  }

  function savePipelineRun(run) {
    pipelineRuns.set(run.id, run);
    mark("pipelineRuns", run.id);
    scheduleFlush(true);
    return run;
  }

  function deletePipelineRun(id) {
    const deleted = pipelineRuns.delete(id);
    if (deleted) {
      mark("pipelineRuns", id, "delete");
      scheduleFlush(true);
    }
    return deleted;
  }

  function listPipelineRuns() {
    return [...pipelineRuns.values()];
  }

  function saveBudgetUsage(record) {
    const key = record.key ?? record.scopeKey;
    budgetUsage.set(key, record);
    mark("budgetUsage", key);
    scheduleFlush(true);
    return record;
  }

  function deleteBudgetUsage(key) {
    const deleted = budgetUsage.delete(key);
    if (deleted) {
      mark("budgetUsage", key, "delete");
      scheduleFlush(true);
    }
    return deleted;
  }

  function saveAuditEvent(event) {
    auditEvents.set(event.id, event);
    mark("auditEvents", event.id);
    scheduleFlush(true);
    return event;
  }

  function deleteAuditEvent(id) {
    const deleted = auditEvents.delete(id);
    if (deleted) {
      mark("auditEvents", id, "delete");
      scheduleFlush(true);
    }
    return deleted;
  }

  function listAuditEvents() {
    return [...auditEvents.values()];
  }

  function listProjectsForUser(userId) {
    return [...projects.values()].filter((project) => project.ownerId === userId);
  }

  function createPasswordReset(email, token) {
    const expiresAt = new Date(Date.now() + 1000 * 60 * 60).toISOString();
    const reset = { id: nextId("reset"), email, token, expiresAt, used: false };
    passwordResets.set(token, reset);
    mark("passwordResets", token);
    scheduleFlush(true);
    return reset;
  }

  function getPasswordReset(token) {
    return passwordResets.get(token) ?? null;
  }

  function deletePasswordReset(token) {
    const deleted = passwordResets.delete(token);
    if (deleted) {
      mark("passwordResets", token, "delete");
      scheduleFlush(true);
    }
    return deleted;
  }

  function setEmailVerificationToken(userId, token) {
    return updateUser(userId, { emailVerificationToken: token });
  }

  function verifyEmail(token) {
    for (const user of users.values()) {
      if (user.emailVerificationToken === token) {
        user.emailVerified = true;
        user.emailVerificationToken = null;
        mark("users", user.id);
        scheduleFlush(true);
        return getUserById(user.id);
      }
    }
    return null;
  }

  function isEmailVerified(userId) {
    const user = users.get(userId);
    return Boolean(user?.emailVerified);
  }

  function flush() {
    // Force an immediate write of everything queued (used by close(), tests, and
    // callers that need durability now) instead of waiting for the coalesce timer.
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    flushChain = flushChain.then(() => flushToPostgres()).catch(() => {});
    return flushChain;
  }

  async function close() {
    await flush();
    await teardown();
  }

  function getStatus() {
    return {
      mode: "postgres",
      migrations: [...state.migrations],
      advisoryLockHeld: state.advisoryLockHeld,
      pendingWrites: dirty.size,
      flushedWrites: state.flushedWrites,
      lastWriteAt: state.lastWriteAt,
      lastWriteError: state.lastWriteError,
      pool: pool
        ? {
            totalCount: pool.totalCount,
            idleCount: pool.idleCount,
            waitingCount: pool.waitingCount,
          }
        : null,
    };
  }

  const testHooks = { withTransaction };

  const store = {
    users,
    sessions,
    projects,
    passwordResets,
    workflows,
    workspaces,
    traces,
    taskflows,
    executionJobs,
    pipelineRuns,
    budgetUsage,
    auditEvents,
    mode: "postgres",
    ready,
    nextId,
    persist,
    persistSoon,
    flush,
    close,
    getStatus,
    updateUser,
    deleteSession,
    deleteSessionsForUser,
    updateProject,
    saveWorkflow,
    listWorkflows,
    saveWorkspace,
    listWorkspaces,
    saveTrace,
    listTraces,
    saveTaskflow,
    listTaskflows,
    saveExecutionJob,
    deleteExecutionJob,
    listExecutionJobs,
    savePipelineRun,
    deletePipelineRun,
    listPipelineRuns,
    saveBudgetUsage,
    deleteBudgetUsage,
    saveAuditEvent,
    deleteAuditEvent,
    listAuditEvents,
    createUser,
    getUserByEmail,
    getUserById,
    createSession,
    getSession,
    validateSessionExpiration,
    createProject,
    getProjectById,
    deleteProject,
    listProjectsForUser,
    createPasswordReset,
    getPasswordReset,
    deletePasswordReset,
    setEmailVerificationToken,
    verifyEmail,
    isEmailVerified,
    testHooks,
  };

  return store;
}
