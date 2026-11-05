/**
 * Database configuration descriptor. Runtime persistence is provided by the atomic JSON file store
 * in storage.js; DATABASE_URL is recorded for planning but no PostgreSQL adapter is implemented.
 */
export function createDatabaseFoundation(options = {}) {
  const config = {
    databaseUrl: options.databaseUrl ?? '',
    nodeEnv: options.nodeEnv ?? 'development',
  };

  const state = {
    mode: config.databaseUrl ? 'postgres' : 'memory',
    status: config.databaseUrl ? 'postgres-not-implemented' : 'safe-memory',
    initialized: false,
    connection: null,
    schema: [],
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
      state.mode = 'memory';
      state.status = 'safe-memory';
      state.initialized = true;
      state.schema = ['users', 'projects', 'sessions', 'audit_events'];
      state.requiresExternalDatabase = false;
      state.safeFallbackEnabled = true;
    } else {
      // No PostgreSQL adapter exists yet: persistence uses the JSON file store (HELIX_STORAGE_PATH).
      state.mode = 'postgres';
      state.status = 'postgres-not-implemented';
      state.initialized = true;
      state.schema = ['users', 'projects', 'sessions', 'audit_events'];
      state.requiresExternalDatabase = true;
      state.safeFallbackEnabled = false;
    }

    foundation.mode = state.mode;
    foundation.status = state.status;
    foundation.initialized = state.initialized;
    foundation.schema = [...state.schema];
    foundation.requiresExternalDatabase = state.requiresExternalDatabase;
    foundation.safeFallbackEnabled = state.safeFallbackEnabled;

    return { ...foundation, ...state };
  }

  async function close() {
    state.initialized = false;
    state.connection = null;
    foundation.initialized = false;
    foundation.connection = null;
    return true;
  }

  return foundation;
}

export default createDatabaseFoundation;
