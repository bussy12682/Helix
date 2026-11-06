export function loadConfig(env = process.env) {
  const appPortValue = Number(env.APP_PORT ?? 3001);
  const databaseUrl = env.DATABASE_URL ?? "";

  return {
    nodeEnv: env.NODE_ENV ?? "development",
    appName: env.APP_NAME ?? "HELIX",
    appPort: Number.isFinite(appPortValue) && appPortValue > 0 ? appPortValue : 3001,
    jwtSecret: env.JWT_SECRET ?? "development-secret-change-me",
    logLevel: ["debug", "info", "warn", "error"].includes(env.HELIX_LOG_LEVEL)
      ? env.HELIX_LOG_LEVEL
      : "info",
    // Operational governance: daily AI token budgets (0 = unlimited), AI route
    // rate limiting, per-project execution concurrency, and the production
    // autonomous-approval policy.
    userDailyTokenLimit: Math.max(0, Number(env.HELIX_USER_DAILY_TOKEN_LIMIT ?? 2_000_000)),
    projectDailyTokenLimit: Math.max(0, Number(env.HELIX_PROJECT_DAILY_TOKEN_LIMIT ?? 4_000_000)),
    aiRateLimitMax: Math.max(1, Number(env.HELIX_AI_RATE_LIMIT_MAX ?? 40)),
    aiRateLimitWindowMs: Math.max(
      1000,
      Number(env.HELIX_AI_RATE_LIMIT_WINDOW_MS ?? 15 * 60 * 1000),
    ),
    maxActiveJobsPerProject: Math.max(1, Number(env.HELIX_MAX_ACTIVE_JOBS_PER_PROJECT ?? 25)),
    autonomousAutoApprove: env.HELIX_AUTONOMOUS_AUTO_APPROVE === "true",
    // Security: opt-in httpOnly cookie sessions alongside bearer tokens, and a
    // configurable preview capability TTL. Cookies are only issued when the
    // request origin is an allowed CORS origin.
    cookieSessions: env.HELIX_COOKIE_SESSIONS === "true",
    sessionCookieName: "helix_session",
    previewTtlMs: Math.max(1000, Number(env.HELIX_PREVIEW_TTL_MS ?? 24 * 60 * 60 * 1000)),
    storagePath: env.HELIX_STORAGE_PATH ?? ".data/helix-state.json",
    workspaceRoot: env.HELIX_WORKSPACE_ROOT ?? ".data/workspaces",
    databaseUrl,
    databaseMode: databaseUrl ? "postgres" : "memory",
    baseUrl: env.BASE_URL ?? "http://localhost:8080",
    // Comma-separated allowed browser origins. Defaults to "*" outside production and BASE_URL in production.
    corsOrigins: (
      env.CORS_ORIGINS ??
      ((env.NODE_ENV ?? "development") === "production" ? (env.BASE_URL ?? "") : "*")
    )
      .split(",")
      .map((o) => o.trim().replace(/\/$/, ""))
      .filter(Boolean),
    maxBodyBytes: Number(env.MAX_BODY_BYTES ?? 25 * 1024 * 1024),
    demoLoginEnabled: env.HELIX_ENABLE_DEMO
      ? env.HELIX_ENABLE_DEMO === "true"
      : (env.NODE_ENV ?? "development") !== "production",

    // Email configuration
    emailProvider: env.EMAIL_PROVIDER ?? "demo", // 'demo', 'smtp', 'sendgrid'
    emailFrom: env.EMAIL_FROM ?? "noreply@helix.app",
    smtpHost: env.SMTP_HOST ?? "",
    smtpPort: Number(env.SMTP_PORT ?? 587),
    smtpUser: env.SMTP_USER ?? "",
    smtpPass: String(env.SMTP_PASS ?? "").replace(/\s+/g, ""),
    smtpSecure: env.SMTP_SECURE === "true",
    sendgridApiKey: env.SENDGRID_API_KEY ?? "",

    // AI project analysis configuration
    aiProvider: env.AI_PROVIDER ?? "google",
    aiApiKey:
      (env.AI_PROVIDER ?? "google") === "google"
        ? (env.GOOGLE_AI_API_KEY ?? "")
        : (env.AI_PROVIDER ?? "google") === "xai"
          ? (env.XAI_API_KEY ?? "")
          : (env.AI_API_KEY ?? ""),
    // Optional override for the primary provider only. Tier-specific defaults live in ModelRouter.
    aiModel: env.AI_MODEL ?? "",
    aiBaseUrl: (
      env.AI_BASE_URL ??
      ((env.AI_PROVIDER ?? "google") === "xai"
        ? "https://api.x.ai/v1"
        : "https://generativelanguage.googleapis.com/v1beta/openai")
    ).replace(/\/$/, ""),
    googleAiApiKey: env.GOOGLE_AI_API_KEY ?? "",
    googleAiModel: env.GOOGLE_TRANSCRIPTION_MODEL ?? "gemini-3.6-flash",
    openAiApiKey: env.AI_API_KEY ?? "",
    openAiBaseUrl: (env.OPENAI_BASE_URL ?? "https://api.openai.com/v1").replace(/\/$/, ""),
    xaiApiKey: env.XAI_API_KEY ?? "",
    xaiBaseUrl: (env.XAI_BASE_URL ?? "https://api.x.ai/v1").replace(/\/$/, ""),
    googleReasoningModel: env.GOOGLE_REASONING_MODEL,
    googleCodingModel: env.GOOGLE_CODING_MODEL,
    googleFastModel: env.GOOGLE_FAST_MODEL,
    openAiReasoningModel: env.OPENAI_REASONING_MODEL,
    openAiCodingModel: env.OPENAI_CODING_MODEL,
    openAiFastModel: env.OPENAI_FAST_MODEL,
    xaiReasoningModel: env.XAI_REASONING_MODEL,
    xaiCodingModel: env.XAI_CODING_MODEL,
    xaiFastModel: env.XAI_FAST_MODEL,
    ollamaBaseUrl: env.OLLAMA_BASE_URL,
    ollamaReasoningModel: env.OLLAMA_REASONING_MODEL,
    ollamaCodingModel: env.OLLAMA_CODING_MODEL,
    ollamaFastModel: env.OLLAMA_FAST_MODEL,
    aiFallbackProviders: env.AI_FALLBACK_PROVIDERS ?? "",
    aiMaxRetries: Number(env.AI_MAX_RETRIES ?? 2),
    aiTimeoutMs: Number(env.AI_TIMEOUT_MS ?? 120000),
    mockMode: env.HELIX_MOCK_AI === "true",
    allowMockFallback: env.HELIX_ALLOW_MOCK_FALLBACK
      ? env.HELIX_ALLOW_MOCK_FALLBACK === "true"
      : (env.NODE_ENV ?? "development") !== "production",
    executionMaxConcurrent: Number(env.EXECUTION_MAX_CONCURRENT ?? 2),
    githubToken: env.HELIX_GITHUB_TOKEN ?? "",
    githubApiBaseUrl: (env.GITHUB_API_BASE_URL ?? "https://api.github.com").replace(/\/$/, ""),

    // OAuth configuration
    googleClientId:
      env.VITE_GOOGLE_CLIENT_ID ?? env.GOOGLE_CLIENT_ID ?? "your-google-client-id-here",
    googleClientSecret: env.GOOGLE_CLIENT_SECRET ?? "your-google-client-secret-here",
    githubClientId:
      env.VITE_GITHUB_CLIENT_ID ?? env.GITHUB_CLIENT_ID ?? "your-github-client-id-here",
    githubClientSecret: env.GITHUB_CLIENT_SECRET ?? "your-github-client-secret-here",
  };
}

export default loadConfig;
