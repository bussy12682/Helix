/**
 * Database configuration descriptor. Persistence is now REAL when DATABASE_URL
 * points at PostgreSQL: storage-postgres.js applies migrations, holds a
 * process-lifetime advisory lock, hydrates the cache, and flushes writes
 * transactionally. This descriptor probes the configured database so callers
 * get an honest, evidence-based status instead of an assumption.
 */
export function createDatabaseFoundation(options = {}) {
  const config = {
    databaseUrl: options.databaseUrl ?? "",
    nodeEnv: options.nodeEnv ?? "development",
  };

  const state = {
    mode: config.databaseUrl ? "postgres" : "memory",
    status: config.databaseUrl ? "postgres-unverified" : "safe-memory",
    initialized: false,
    connection: null,
    schema: ["users", "sessions", "projects", "password_resets", "workflows", "workspaces", "traces", "taskflows", "helix_migrations"],
    migrations: [],
    error: null,
    requiresExternalDatabase: Boolean(config.databaseUrl),
    safeFallbackEnabled: !config.databaseUrl,
  };

  const foundation = {
    ...config,
    mode: state.mode,
    status: state.status,
    initialized: state.initialized,
    connection: state.connection,
    schema: state.schema,
    requiresExternalDatabase: state.requiresExternalDatabase,
    safeFallbackEnabled: state.safeFallbackEnabled,
    init,
    close,
  };

  async function init() {
    if (state.initialized) {
      return { ...foundation, ...state };
    }

    if (!config.databaseUrl) {
      state.mode = "memory";
      state.status = "safe-memory";
      state.initialized = true;
      return { ...foundation, ...state };
    }

    // Real probe: connect, read applied migrations, then disconnect.
    try {
      const pg = await import("pg");
      const client = new pg.Client({ connectionString: config.databaseUrl });
      await client.connect();
      const { rows } = await client.query(
        "SELECT version, name, applied_at FROM helix_migrations ORDER BY version",
      );
      await client.end();
      state.connection = { database: config.databaseUrl.replace(/:[^:@/]+@/, ":***@") };
      state.migrations = rows.map((row) => row.name);
      state.status = "postgres-ready";
    } catch (error) {
      state.status = "postgres-unreachable";
      state.error = error.message;
    }
    state.initialized = true;
    return { ...foundation, ...state };
  }

  async function close() {
    state.initialized = false;
    return { ...foundation, ...state };
  }

  return foundation;
}
