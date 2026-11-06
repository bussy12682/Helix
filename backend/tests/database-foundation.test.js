import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadConfig } from "../config.js";
import { createDatabaseFoundation } from "../database.js";
import { createMemoryStore } from "../storage.js";

test("config includes database settings for the Phase 0 foundation", () => {
  const config = loadConfig({
    NODE_ENV: "test",
    APP_PORT: "3002",
    DATABASE_URL: "postgresql://helix:helix@localhost:5432/helix_test",
  });

  assert.equal(config.nodeEnv, "test");
  assert.equal(config.appPort, 3002);
  assert.equal(config.databaseUrl, "postgresql://helix:helix@localhost:5432/helix_test");
  assert.equal(config.databaseMode, "postgres");
});

test("database foundation initializes in a safe mode when no database is configured", async () => {
  const foundation = createDatabaseFoundation({
    databaseUrl: "",
    nodeEnv: "development",
  });

  const state = await foundation.init();

  assert.equal(foundation.mode, "memory");
  assert.equal(state.mode, "memory");
  assert.equal(state.status, "safe-memory");
  assert.equal(typeof foundation.init, "function");
  assert.equal(typeof foundation.close, "function");
});

test("database foundation reports an unreachable PostgreSQL server honestly", async () => {
  const foundation = createDatabaseFoundation({
    databaseUrl: "postgresql://helix:helix@127.0.0.1:59999/helix_missing",
    nodeEnv: "production",
  });

  const state = await foundation.init();

  assert.equal(state.mode, "postgres");
  assert.ok(state.schema.includes("users"));
  assert.ok(state.schema.includes("helix_migrations"));
  assert.equal(state.requiresExternalDatabase, true);
  assert.equal(state.safeFallbackEnabled, false);
  assert.equal(state.status, "postgres-unreachable");
  assert.ok(state.error.length > 0);
});

test(
  "database foundation verifies a reachable PostgreSQL server with its real migrations",
  { skip: process.env.HELIX_PG_TEST_URL ? false : "set HELIX_PG_TEST_URL to run the live probe" },
  async () => {
    const { provisionDatabase } = await import("./postgres-store-helpers.js");
    const db = await provisionDatabase(process.env.HELIX_PG_TEST_URL);
    try {
      const { createPostgresStore } = await import("../storage-postgres.js");
      const store = createPostgresStore({ connectionString: db.url });
      await store.ready;
      await store.close();

      const foundation = createDatabaseFoundation({ databaseUrl: db.url, nodeEnv: "production" });
      const state = await foundation.init();
      assert.equal(state.status, "postgres-ready");
      assert.ok(state.migrations.includes("001_core_entities.sql"));
      assert.equal(state.error, null);
    } finally {
      await db.dispose();
    }
  },
);

test("project storage survives a backend restart when a storage path is configured", () => {
  const directory = mkdtempSync(join(tmpdir(), "helix-storage-"));
  const storagePath = join(directory, "state.json");

  try {
    const firstStore = createMemoryStore({ storagePath });
    const project = firstStore.createProject({
      ownerId: "user_restart_test",
      name: "Persistent HELIX Project",
      description: "Project data must survive a backend restart.",
    });

    const restartedStore = createMemoryStore({ storagePath });
    assert.deepEqual(restartedStore.getProjectById(project.id), project);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
