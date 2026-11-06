/**
 * PostgreSQL persistence integration tests.
 *
 * These run ONLY against a real PostgreSQL server provided via HELIX_PG_TEST_URL
 * (e.g. postgres://user:pass@127.0.0.1:55432/postgres). Without it they skip with
 * an explicit notice — persistence is never faked. Each run provisions and drops
 * a uniquely named database, so repeated runs are safe.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { createApp } from "../app.js";
import { createPostgresStore } from "../storage-postgres.js";
import { call, signUp } from "./helpers.js";
import { provisionDatabase } from "./postgres-store-helpers.js";

const baseUrl = process.env.HELIX_PG_TEST_URL ?? "";

const options = { skip: baseUrl ? false : "set HELIX_PG_TEST_URL to a real PostgreSQL server to run persistence tests" };

test("postgres store persists, recovers, cascades, and enforces single-instance ownership", options, async (t) => {
  const db = await provisionDatabase(baseUrl);
  const openStores = [];
  const track = (store) => (openStores.push(store), store);
  // node:test runs t.after hooks in registration order: close every store
  // (draining its pool) BEFORE dropping the database.
  t.after(async () => {
    for (const store of openStores) await store.close().catch(() => {});
    await db.dispose();
  });

  // 1. Boot: migrations apply and the advisory lock is held.
  const store = track(createPostgresStore({ connectionString: db.url }));
  await store.ready;
  const status = store.getStatus();
  assert.equal(status.mode, "postgres");
  assert.ok(status.migrations.includes("001_core_entities.sql"), JSON.stringify(status));
  assert.equal(status.advisoryLockHeld, true);

  // 2. Writes reach the cache and PostgreSQL.
  const user = store.createUser({ name: "PG User", email: "pg-user@example.com", passwordHash: "x" });
  const project = store.createProject({ ownerId: user.id, name: "Durable", description: "d", keyFeatures: [], techStack: [] });
  const session = store.createSession(user.id, false);
  store.saveWorkflow({ id: "wf_pg_1", projectId: project.id, status: "completed", tasks: [] });
  store.saveTrace({ workflowId: "wf_pg_1", spanId: "s1", agent: "product_manager" });
  store.saveTaskflow({ id: "tf_pg_1", projectId: project.id, tasks: [] });
  await store.flush();
  {
    const rows = await db.query("SELECT count(*)::int AS n FROM users WHERE id = $1", [user.id]);
    assert.equal(rows.rows[0].n, 1);
    const workflows = await db.query("SELECT count(*)::int AS n FROM workflows WHERE project_id = $1", [project.id]);
    assert.equal(workflows.rows[0].n, 1);
  }

  // 3. Crash recovery: a brand-new store hydrates everything from PostgreSQL.
  await store.close();
  const second = track(createPostgresStore({ connectionString: db.url }));
  await second.ready;
  assert.equal(second.getUserByEmail("pg-user@example.com")?.id, user.id);
  assert.equal(second.getProjectById(project.id)?.name, "Durable");
  assert.equal(second.validateSessionExpiration(session.token).isValid, true);
  assert.equal(second.listWorkflows()[0]?.id, "wf_pg_1");
  assert.equal(second.listTraces()[0]?.spans.length, 1);
  assert.equal(second.listTaskflows()[0]?.id, "tf_pg_1");

  // 4. deleteProject cascades to workflows, traces, and TASKFLOWs in PostgreSQL.
  second.deleteProject(project.id);
  await second.flush();
  {
    const rows = await db.query(
      `SELECT (SELECT count(*)::int FROM projects WHERE id = $1) AS p,
              (SELECT count(*)::int FROM workflows WHERE project_id = $1) AS w,
              (SELECT count(*)::int FROM traces WHERE workflow_id = 'wf_pg_1') AS t,
              (SELECT count(*)::int FROM taskflows WHERE project_id = $1) AS f`,
      [project.id],
    );
    const counts = rows.rows[0];
    assert.equal(counts.p, 0);
    assert.equal(counts.w, 0);
    assert.equal(counts.t, 0);
    assert.equal(counts.f, 0);
  }

  // 5. A second concurrent instance is refused (split-brain prevention).
  await assert.rejects(
    createPostgresStore({ connectionString: db.url }).ready,
    /advisory lock|another HELIX instance/i,
  );

  // 6. Transaction safety: a failing multi-statement transaction rolls back completely
  //    and the failure is surfaced, never swallowed.
  const before = await db.query("SELECT count(*)::int AS n FROM users");
  await assert.rejects(
    second.testHooks.withTransaction(async (client) => {
      await client.query("INSERT INTO users (id, email, doc) VALUES ('ghost', 'ghost@example.com', '{}')");
      await client.query("INSERT INTO broken_table_on_purpose VALUES (1)");
    }),
    /broken_table_on_purpose|does not exist/i,
  );
  const after = await db.query("SELECT count(*)::int AS n FROM users");
  assert.equal(after.rows[0].n, before.rows[0].n, "a failed transaction must not partially persist");

  // 7. A failed flush is surfaced and stays queued — never silently dropped.
  await db.query("DROP TABLE password_resets");
  second.createPasswordReset("pg-user@example.com", "reset-queued");
  await second.flush();
  const failedStatus = second.getStatus();
  assert.ok(failedStatus.lastWriteError, "a failed flush must be reported");
  assert.ok(failedStatus.pendingWrites >= 1, "the failed write must remain queued for retry");

  await second.close();
});

test("the full API stack persists across a restart when DATABASE_URL is set", options, async (t) => {
  const db = await provisionDatabase(baseUrl);
  const root = await mkdtemp(path.join(tmpdir(), "helix-pg-app-"));
  const openApps = [];
  const boot = async () => {
    const instance = createApp({ storagePath: ":memory:", env });
    openApps.push(instance);
    await instance.ready;
    return instance;
  };
  // Close every app (each drains its store pool) BEFORE dropping the database,
  // then clean the workspace root.
  t.after(async () => {
    for (const instance of openApps) await instance.close().catch(() => {});
    await db.dispose();
    await rm(root, { recursive: true, force: true });
  });

  const env = {
    HELIX_WORKSPACE_ROOT: root,
    DATABASE_URL: db.url,
    HELIX_MOCK_AI: "true",
  };

  // First instance: a real user, project, and workspace file through the API.
  const first = await boot();
  const { token, user } = await signUp(first, `pg-api-${crypto.randomUUID()}@example.com`);
  const created = await call(first, "POST", "/api/v1/projects", {
    token,
    body: { name: "Restart Survivor", description: "must survive", keyFeatures: ["durability"], techStack: ["Node.js"] },
  });
  assert.equal(created.status, 201);
  const written = await call(first, "PUT", `/api/v1/projects/${created.json.id}/files`, {
    token,
    body: { path: "hello.txt", content: "durable" },
  });
  assert.equal(written.status, 200, JSON.stringify(written.json));
  await first.close();
  await new Promise((resolve) => setTimeout(resolve, 100));

  // Second instance on the same database: the state must be fully recovered.
  const second = await boot();
  const login = await call(second, "POST", "/api/v1/auth/login", {
    body: { email: user.email, password: "Password123!" },
  });
  assert.equal(login.status, 200, JSON.stringify(login.json));
  const projects = await call(second, "GET", "/api/v1/projects", { token: login.json.token });
  assert.equal(projects.status, 200);
  const survivor = projects.json.find?.((entry) => entry.id === created.json.id) ?? projects.json.projects?.find((entry) => entry.id === created.json.id);
  assert.ok(survivor, `project must survive the restart: ${JSON.stringify(projects.json).slice(0, 300)}`);
  const files = await call(second, "GET", `/api/v1/projects/${created.json.id}/files`, { token: login.json.token });
  assert.equal(files.status, 200);
  assert.ok(files.json.files.some((file) => file.path === "hello.txt"), "workspace files must survive the restart");
  assert.equal(second.getStatus().mode, "postgres");
});
