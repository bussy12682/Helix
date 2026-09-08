export function loadConfig(env = process.env) {
  const appPortValue = Number(env.APP_PORT ?? 3001);
  const databaseUrl = env.DATABASE_URL ?? '';

  return {
    nodeEnv: env.NODE_ENV ?? 'development',
    appName: env.APP_NAME ?? 'HELIX',
    appPort: Number.isFinite(appPortValue) && appPortValue > 0 ? appPortValue : 3001,
    jwtSecret: env.JWT_SECRET ?? 'development-secret-change-me',
    storagePath: env.HELIX_STORAGE_PATH ?? '.data/helix-state.json',
    databaseUrl,
    databaseMode: databaseUrl ? 'postgres' : 'memory',
    baseUrl: env.BASE_URL ?? 'http://localhost:8080',
    
    // Email configuration
    emailProvider: env.EMAIL_PROVIDER ?? 'demo', // 'demo', 'smtp', 'sendgrid'
    emailFrom: env.EMAIL_FROM ?? 'noreply@helix.app',
    smtpHost: env.SMTP_HOST ?? '',
    smtpPort: Number(env.SMTP_PORT ?? 587),
    smtpUser: env.SMTP_USER ?? '',
    smtpPass: String(env.SMTP_PASS ?? '').replace(/\s+/g, ''),
    smtpSecure: env.SMTP_SECURE === 'true',
    sendgridApiKey: env.SENDGRID_API_KEY ?? '',

    // AI project analysis configuration
    aiProvider: env.AI_PROVIDER ?? 'google',
    aiApiKey: (env.AI_PROVIDER ?? 'google') === 'google'
      ? (env.GOOGLE_AI_API_KEY ?? '')
      : (env.AI_PROVIDER ?? 'google') === 'xai'
        ? (env.XAI_API_KEY ?? '')
        : (env.AI_API_KEY ?? ''),
    aiModel: env.AI_MODEL ?? ((env.AI_PROVIDER ?? 'google') === 'xai' ? 'grok-3-mini' : 'gemini-3.6-flash'),
    aiBaseUrl: (env.AI_BASE_URL ?? ((env.AI_PROVIDER ?? 'google') === 'xai'
      ? 'https://api.x.ai/v1'
      : 'https://generativelanguage.googleapis.com/v1beta/openai')).replace(/\/$/, ''),
    googleAiApiKey: env.GOOGLE_AI_API_KEY ?? '',
    googleAiModel: env.GOOGLE_TRANSCRIPTION_MODEL ?? 'gemini-3.6-flash',
    openAiApiKey: env.AI_API_KEY ?? '',
    openAiBaseUrl: (env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1').replace(/\/$/, ''),
    
    // OAuth configuration
    googleClientId: env.VITE_GOOGLE_CLIENT_ID ?? env.GOOGLE_CLIENT_ID ?? 'your-google-client-id-here',
    googleClientSecret: env.GOOGLE_CLIENT_SECRET ?? 'your-google-client-secret-here',
    githubClientId: env.VITE_GITHUB_CLIENT_ID ?? env.GITHUB_CLIENT_ID ?? 'your-github-client-id-here',
    githubClientSecret: env.GITHUB_CLIENT_SECRET ?? 'your-github-client-secret-here',
  };
}

export default loadConfig;
