export function createDatabaseFoundation(options = {}) {
  const config = {
    databaseUrl: options.databaseUrl ?? '',
    nodeEnv: options.nodeEnv ?? 'development',
  };

  const state = {
    mode: config.databaseUrl ? 'postgres' : 'memory',
    status: config.databaseUrl ? 'postgres-ready' : 'safe-memory',
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
      state.mode = 'postgres';
      state.status = 'postgres-ready';
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
