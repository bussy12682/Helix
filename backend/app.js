import { createHash, randomUUID } from 'node:crypto';

import { loadConfig } from './config.js';
import { createMemoryStore } from './storage.js';
import { initializeEmailService, sendVerificationEmail, sendPasswordResetEmail } from './email.js';
import { RateLimiter } from './rate-limiter.js';
import { validatePasswordComplexity } from './password-validator.js';
import { analyzeProjectBrief, respondToVoiceTurn, transcribeVoiceNote } from './ai.js';
import { extractRawText } from 'mammoth';
import { PDFParse } from 'pdf-parse';

export function createApp(overrides = {}) {
  const config = loadConfig(overrides.env ?? process.env);
  const store = createMemoryStore({ storagePath: overrides.storagePath ?? config.storagePath });
  const loginRateLimiter = new RateLimiter();
  const registerRateLimiter = new RateLimiter();
  const passwordResetRateLimiter = new RateLimiter();

  // Initialize email service
  initializeEmailService(config);

  const app = {
    config,
    store,
    loginRateLimiter,
    registerRateLimiter,
    passwordResetRateLimiter,
    async request(input, init = {}) {
      const request = input instanceof Request ? input : new Request(input, init);
      const requestId = randomUUID();
      const response = await handleRequest({ request, config, store, loginRateLimiter, registerRateLimiter, passwordResetRateLimiter, requestId });
      response.headers.set('x-request-id', requestId);
      response.headers.set('x-correlation-id', requestId);
      return response;
    },
  };

  app.fetch = app.request.bind(app);
  return app;
}

async function handleRequest({ request, config, store, loginRateLimiter, registerRateLimiter, passwordResetRateLimiter, requestId }) {
  const url = new URL(request.url);
  const path = url.pathname;

  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization',
        'x-correlation-id': requestId,
      },
    });
  }

  if (request.method === 'GET' && path === '/api/v1/health') {
    return jsonResponse(200, {
      ok: true,
      service: 'helix-core',
      status: 'healthy',
      requestId,
      environment: config.nodeEnv,
      timestamp: new Date().toISOString(),
    });
  }

  if (request.method === 'POST' && path === '/api/v1/auth/register') {
    return handleRegister({ request, config, store, registerRateLimiter, requestId });
  }

  if (request.method === 'POST' && path === '/api/v1/auth/login') {
    return handleLogin({ request, config, store, loginRateLimiter, requestId });
  }

  if (request.method === 'POST' && path === '/api/v1/auth/google/callback') {
    return handleGoogleCallback({ request, config, store, requestId });
  }

  if (request.method === 'POST' && path === '/api/v1/auth/github/callback') {
    return handleGitHubCallback({ request, config, store, requestId });
  }

  if (request.method === 'POST' && path === '/api/v1/auth/password-reset/request') {
    return handlePasswordResetRequest({ request, config, store, passwordResetRateLimiter, requestId });
  }

  if (request.method === 'POST' && path === '/api/v1/auth/password-reset/complete') {
    return handlePasswordResetComplete({ request, config, store, requestId });
  }

  if (request.method === 'POST' && path === '/api/v1/auth/verify-email') {
    return handleVerifyEmail({ request, store, requestId });
  }

  if (request.method === 'GET' && path === '/api/v1/projects') {
    return handleListProjects({ request, store, requestId });
  }

  if (request.method === 'GET' && path === '/api/v1/dashboard') {
    return handleGetDashboard({ request, store, requestId });
  }

  if (request.method === 'POST' && path === '/api/v1/projects') {
    return handleCreateProject({ request, store, requestId });
  }

  if (request.method === 'POST' && path === '/api/v1/projects/analyze') {
    return handleAnalyzeProject({ request, config, store, requestId });
  }

  if (request.method === 'POST' && path === '/api/v1/voice/turn') {
    return handleVoiceTurn({ request, config, store, requestId });
  }

  if (request.method === 'POST' && path === '/api/v1/voice/transcribe') {
    return handleVoiceTranscription({ request, config, store, requestId });
  }

  if (request.method === 'POST' && path === '/api/v1/projects/extract-document') {
    return handleExtractProjectDocument({ request, store, requestId });
  }

  if (request.method === 'DELETE' && /^\/api\/v1\/projects\//.test(path)) {
    return handleDeleteProject({ request, store, requestId, path });
  }

  if (request.method === 'GET' && /^\/api\/v1\/projects\//.test(path)) {
    return handleGetProject({ request, store, requestId, path });
  }

  return jsonResponse(404, {
    error: {
      code: 'NOT_FOUND',
      message: 'Route not found',
      requestId,
    },
  });
}

function jsonResponse(status, payload, headers = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type,Authorization',
      ...headers,
    },
  });
}

async function parseJsonBody(request) {
  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    return {};
  }

  try {
    const text = await request.text();
    return text ? JSON.parse(text) : {};
  } catch {
    return {};
  }
}

function requireAuth(request, store) {
  const header = request.headers.get('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : null;

  if (!token) {
    return {
      error: jsonResponse(401, {
        error: {
          code: 'UNAUTHORIZED',
          message: 'Missing bearer token',
          requestId: randomUUID(),
        },
      }),
    };
  }

  // Validate session expiration
  const sessionStatus = store.validateSessionExpiration(token);
  if (!sessionStatus.isValid) {
    const errorCode = sessionStatus.expired ? 'SESSION_EXPIRED' : 'INVALID_SESSION';
    const message = sessionStatus.expired ? 'Your session has expired. Please log in again.' : 'Invalid or expired session';
    return {
      error: jsonResponse(401, {
        error: {
          code: errorCode,
          message,
          requestId: randomUUID(),
        },
      }),
    };
  }

  const session = store.getSession(token);
  if (!session) {
    return {
      error: jsonResponse(401, {
        error: {
          code: 'UNAUTHORIZED',
          message: 'Invalid or expired session',
          requestId: randomUUID(),
        },
      }),
    };
  }

  const user = store.getUserById(session.userId);
  if (!user) {
    return {
      error: jsonResponse(401, {
        error: {
          code: 'UNAUTHORIZED',
          message: 'Session user not found',
          requestId: randomUUID(),
        },
      }),
    };
  }

  return { user, session };
}

function hashPassword(password, secret) {
  return createHash('sha256').update(`${password}:${secret}`).digest('hex');
}

async function handleRegister({ request, config, store, registerRateLimiter, requestId }) {
  const body = await parseJsonBody(request);
  const name = String(body.name ?? '').trim();
  const email = String(body.email ?? '').trim().toLowerCase();
  const password = String(body.password ?? '');

  // Rate limiting
  const clientIp = request.headers.get('x-forwarded-for') || 'unknown';
  if (registerRateLimiter.isLimited(`register:${clientIp}`)) {
    return jsonResponse(429, {
      error: {
        code: 'RATE_LIMITED',
        message: 'Too many registration attempts. Please try again later.',
        requestId,
      },
    });
  }

  if (!name || !email || password.length < 8) {
    return jsonResponse(400, {
      error: {
        code: 'INVALID_INPUT',
        message: 'Name, valid email and password of at least 8 characters are required',
        requestId,
      },
    });
  }

  // Validate email format
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return jsonResponse(400, {
      error: {
        code: 'INVALID_EMAIL',
        message: 'Please provide a valid email address',
        requestId,
      },
    });
  }

  // Validate password complexity
  const passwordValidation = validatePasswordComplexity(password);
  if (!passwordValidation.isValid) {
    return jsonResponse(400, {
      error: {
        code: 'WEAK_PASSWORD',
        message: 'Password does not meet complexity requirements',
        details: passwordValidation.errors,
        strength: passwordValidation.strength,
        requestId,
      },
    });
  }

  if (store.getUserByEmail(email)) {
    return jsonResponse(409, {
      error: {
        code: 'USER_EXISTS',
        message: 'User with this email already exists',
        requestId,
      },
    });
  }

  const user = store.createUser({
    name,
    email,
    passwordHash: hashPassword(password, config.jwtSecret),
  });

  // Generate and set email verification token
  const verificationToken = `verify_${randomUUID()}`;
  store.setEmailVerificationToken(user.id, verificationToken);

  let verificationEmailSent = false;
  try {
    await sendVerificationEmail(email, verificationToken, config.baseUrl);
    verificationEmailSent = true;
  } catch (error) {
    console.error('Failed to send verification email:', error);
  }

  const response = {
    id: user.id,
    name: user.name,
    email: user.email,
    emailVerified: user.emailVerified,
    verificationEmailSent,
    message: 'Account created. Please check your email to verify.',
  };

  if (config.nodeEnv !== 'production') {
    response.verificationToken = verificationToken;
  }

  return jsonResponse(201, response, { 'x-correlation-id': requestId });
}

async function handleLogin({ request, config, store, loginRateLimiter, requestId }) {
  const body = await parseJsonBody(request);
  const email = String(body.email ?? '').trim().toLowerCase();
  const password = String(body.password ?? '');
  const rememberMe = Boolean(body.rememberMe ?? false);

  // Rate limiting per email
  if (loginRateLimiter.isLimited(`login:${email}`, 5, 15 * 60 * 1000)) {
    return jsonResponse(429, {
      error: {
        code: 'RATE_LIMITED',
        message: 'Too many login attempts. Please try again in 15 minutes.',
        requestId,
      },
    });
  }

  if (!email || !password) {
    return jsonResponse(400, {
      error: {
        code: 'INVALID_INPUT',
        message: 'Email and password are required',
        requestId,
      },
    });
  }

  const user = store.getUserByEmail(email);
  if (!user || user.passwordHash !== hashPassword(password, config.jwtSecret)) {
    return jsonResponse(401, {
      error: {
        code: 'INVALID_CREDENTIALS',
        message: 'Invalid email or password',
        requestId,
      },
    });
  }

  // Check if email is verified
  if (!user.emailVerified) {
    const error = {
      code: 'EMAIL_NOT_VERIFIED',
      message: 'Please verify your email before logging in',
      requestId,
    };

    if (config.emailProvider === 'demo') {
      error.verificationToken = user.emailVerificationToken;
    }

    return jsonResponse(403, {
      error: {
        ...error,
      },
    });
  }

  // Create session with remember-me support
  const session = store.createSession(user.id, rememberMe);

  // Reset rate limiter on successful login
  loginRateLimiter.reset(`login:${email}`);

  return jsonResponse(200, {
    token: session.token,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
    },
    expiresAt: session.expiresAt,
    rememberMe: session.rememberMe,
  });
}

async function handleListProjects({ request, store, requestId }) {
  const auth = requireAuth(request, store);
  if ('error' in auth) {
    return auth.error;
  }

  const projects = store.listProjectsForUser(auth.user.id);
  return jsonResponse(200, projects, { 'x-correlation-id': requestId });
}

async function handleGetDashboard({ request, store, requestId }) {
  const auth = requireAuth(request, store);
  if ('error' in auth) {
    return auth.error;
  }

  const projects = store.listProjectsForUser(auth.user.id);
  const completedProjects = projects.filter((project) => project.status === 'completed').length;

  return jsonResponse(200, {
    user: {
      id: auth.user.id,
      name: auth.user.name,
      email: auth.user.email,
    },
    projects,
    stats: {
      projects: projects.length,
      activeProjects: projects.length - completedProjects,
      completedProjects,
      deployments: 0,
    },
  }, { 'x-correlation-id': requestId });
}

async function handleCreateProject({ request, store, requestId }) {
  const auth = requireAuth(request, store);
  if ('error' in auth) {
    return auth.error;
  }

  const body = await parseJsonBody(request);
  const name = String(body.name ?? '').trim();
  const description = String(body.description ?? '').trim();
  const keyFeatures = Array.isArray(body.keyFeatures)
    ? body.keyFeatures.map((feature) => String(feature).trim()).filter(Boolean).slice(0, 12)
    : [];
  const techStack = Array.isArray(body.techStack)
    ? body.techStack.map((technology) => String(technology).trim()).filter(Boolean).slice(0, 12)
    : [];

  if (!name) {
    return jsonResponse(400, {
      error: {
        code: 'INVALID_INPUT',
        message: 'Project name is required',
        requestId,
      },
    });
  }

  const project = store.createProject({
    ownerId: auth.user.id,
    name,
    description,
    keyFeatures,
    techStack,
  });

  return jsonResponse(201, project, { 'x-correlation-id': requestId });
}

async function handleAnalyzeProject({ request, config, store, requestId }) {
  const auth = requireAuth(request, store);
  if ('error' in auth) {
    return auth.error;
  }

  const body = await parseJsonBody(request);
  const name = String(body.name ?? '').trim();
  const description = String(body.description ?? '').trim();
  const conversation = Array.isArray(body.conversation)
    ? body.conversation
      .filter((message) => message && ['user', 'assistant'].includes(message.role))
      .map((message) => ({ role: message.role, content: String(message.content ?? '').trim() }))
      .filter((message) => message.content)
      .slice(-24)
    : [];

  if (!name || !description) {
    return jsonResponse(400, {
      error: {
        code: 'INVALID_INPUT',
        message: 'Project name and description are required',
        requestId,
      },
    });
  }

  try {
    const analysis = await analyzeProjectBrief({ name, description, conversation }, config);
    return jsonResponse(200, analysis, { 'x-correlation-id': requestId });
  } catch (error) {
    const code = error?.code ?? 'AI_PROVIDER_ERROR';
    const status = code === 'AI_NOT_CONFIGURED' ? 503 : 502;
    return jsonResponse(status, {
      error: {
        code,
        message: error instanceof Error ? error.message : 'Project analysis failed. Please try again.',
        requestId,
      },
    });
  }
}

async function handleVoiceTurn({ request, config, store, requestId }) {
  const auth = requireAuth(request, store);
  if ('error' in auth) {
    return auth.error;
  }

  const body = await parseJsonBody(request);
  const name = String(body.name ?? '').trim();
  const messages = Array.isArray(body.messages)
    ? body.messages
      .filter((message) => message && ['user', 'assistant'].includes(message.role))
      .map((message) => ({ role: message.role, content: String(message.content ?? '').trim() }))
      .filter((message) => message.content)
      .slice(-12)
    : [];

  if (!name || !messages.length || messages[messages.length - 1].role !== 'user') {
    return jsonResponse(400, {
      error: { code: 'INVALID_INPUT', message: 'Project name and a user voice message are required', requestId },
    });
  }

  try {
    const reply = await respondToVoiceTurn({ name, messages }, config);
    return jsonResponse(200, { reply }, { 'x-correlation-id': requestId });
  } catch (error) {
    const code = error?.code ?? 'AI_PROVIDER_ERROR';
    return jsonResponse(code === 'AI_NOT_CONFIGURED' ? 503 : 502, {
      error: {
        code,
        message: error instanceof Error ? error.message : 'Voice AI could not respond. Please try again.',
        requestId,
      },
    });
  }
}

async function handleVoiceTranscription({ request, config, store, requestId }) {
  const auth = requireAuth(request, store);
  if ('error' in auth) return auth.error;

  const formData = await request.formData();
  const file = formData.get('audio');
  if (!(file instanceof File)) {
    return jsonResponse(400, { error: { code: 'INVALID_INPUT', message: 'An audio recording is required', requestId } });
  }
  if (file.size > 10 * 1024 * 1024) {
    return jsonResponse(413, { error: { code: 'FILE_TOO_LARGE', message: 'Voice notes must be 10 MB or smaller', requestId } });
  }

  try {
    const transcript = await transcribeVoiceNote({
      audio: Buffer.from(await file.arrayBuffer()),
      mimeType: file.type || 'audio/webm',
    }, config);
    return jsonResponse(200, { transcript }, { 'x-correlation-id': requestId });
  } catch (error) {
    const code = error?.code ?? 'AI_PROVIDER_ERROR';
    return jsonResponse(code === 'AI_NOT_CONFIGURED' ? 503 : 502, {
      error: { code, message: error instanceof Error ? error.message : 'Voice transcription failed.', requestId },
    });
  }
}

async function handleExtractProjectDocument({ request, store, requestId }) {
  const auth = requireAuth(request, store);
  if ('error' in auth) {
    return auth.error;
  }

  const formData = await request.formData();
  const file = formData.get('file');
  if (!(file instanceof File)) {
    return jsonResponse(400, {
      error: { code: 'INVALID_INPUT', message: 'A document file is required', requestId },
    });
  }

  const maxFileSize = 10 * 1024 * 1024;
  if (file.size > maxFileSize) {
    return jsonResponse(413, {
      error: { code: 'FILE_TOO_LARGE', message: 'Documents must be 10 MB or smaller', requestId },
    });
  }

  const extension = file.name.toLowerCase().split('.').pop();
  const supportedExtensions = new Set(['docx', 'md', 'markdown', 'txt', 'pdf']);
  if (!supportedExtensions.has(extension)) {
    return jsonResponse(415, {
      error: { code: 'UNSUPPORTED_FILE_TYPE', message: 'Upload a PDF, DOCX, Markdown or text document', requestId },
    });
  }

  try {
    let text;
    if (extension === 'docx') {
      const result = await extractRawText({ buffer: Buffer.from(await file.arrayBuffer()) });
      text = result.value;
    } else if (extension === 'pdf') {
      const parser = new PDFParse({ data: Buffer.from(await file.arrayBuffer()) });
      const result = await parser.getText();
      await parser.destroy();
      text = result.text;
    } else {
      text = await file.text();
    }

    const description = text.replace(/\u0000/g, '').trim().slice(0, 30000);
    if (!description) {
      return jsonResponse(422, {
        error: { code: 'EMPTY_DOCUMENT', message: 'The document did not contain readable text', requestId },
      });
    }

    return jsonResponse(200, {
      fileName: file.name,
      description,
      truncated: text.trim().length > description.length,
    }, { 'x-correlation-id': requestId });
  } catch (error) {
    return jsonResponse(422, {
      error: {
        code: 'DOCUMENT_PARSE_FAILED',
        message: error instanceof Error ? `Could not read ${file.name}` : 'Could not read the document',
        requestId,
      },
    });
  }
}

async function handleDeleteProject({ request, store, requestId, path }) {
  const auth = requireAuth(request, store);
  if ('error' in auth) {
    return auth.error;
  }

  const projectId = path.replace('/api/v1/projects/', '');
  const project = store.getProjectById(projectId);

  if (!project) {
    return jsonResponse(404, {
      error: {
        code: 'NOT_FOUND',
        message: 'Project not found',
        requestId,
      },
    });
  }

  if (project.ownerId !== auth.user.id) {
    return jsonResponse(403, {
      error: {
        code: 'FORBIDDEN',
        message: 'You do not have access to this project',
        requestId,
      },
    });
  }

  store.deleteProject(projectId);
  return jsonResponse(200, { message: 'Project deleted', id: projectId }, { 'x-correlation-id': requestId });
}

async function handleGetProject({ request, store, requestId, path }) {
  const auth = requireAuth(request, store);
  if ('error' in auth) {
    return auth.error;
  }

  const projectId = path.replace('/api/v1/projects/', '');
  const project = store.getProjectById(projectId);

  if (!project) {
    return jsonResponse(404, {
      error: {
        code: 'NOT_FOUND',
        message: 'Project not found',
        requestId,
      },
    });
  }

  if (project.ownerId !== auth.user.id) {
    return jsonResponse(403, {
      error: {
        code: 'FORBIDDEN',
        message: 'You do not have access to this project',
        requestId,
      },
    });
  }

  return jsonResponse(200, project, { 'x-correlation-id': requestId });
}

async function handleGoogleCallback({ request, config, store, requestId }) {
  const body = await parseJsonBody(request);
  const code = String(body.code ?? '').trim();
  const redirectUri = String(body.redirectUri ?? '').trim() || `${config.baseUrl}/auth/google/callback`;

  if (!code) {
    return jsonResponse(400, {
      error: {
        code: 'INVALID_INPUT',
        message: 'Authorization code is required',
        requestId,
      },
    });
  }

  try {
    // Real OAuth: Exchange code for token with Google
    if (config.googleClientId && config.googleClientSecret && config.googleClientId !== 'your-google-client-id-here') {
      const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: config.googleClientId,
          client_secret: config.googleClientSecret,
          redirect_uri: redirectUri,
          grant_type: 'authorization_code',
        }),
      });

      if (!tokenResponse.ok) {
        throw new Error('Failed to exchange Google token');
      }

      const { access_token } = await tokenResponse.json();

      // Get user info from Google
      const userResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { Authorization: `Bearer ${access_token}` },
      });

      if (!userResponse.ok) {
        throw new Error('Failed to fetch Google user info');
      }

      const googleUser = await userResponse.json();
      const email = googleUser.email.toLowerCase();
      const name = googleUser.name || 'Google User';

      let user = store.getUserByEmail(email);
      if (!user) {
        user = store.createUser({
          name,
          email,
          passwordHash: hashPassword('oauth-user', config.jwtSecret),
        });
        // Mark email as verified for OAuth users
        user.emailVerified = true;
      }

      const session = store.createSession(user.id);

      return jsonResponse(200, {
        token: session.token,
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
        },
        expiresAt: session.expiresAt,
      });
    } else {
      // Demo mode: Create or find demo user
      const email = `google-${randomUUID().slice(0, 8)}@demo.helix.app`;
      const name = 'Google User';

      let user = store.getUserByEmail(email);
      if (!user) {
        user = store.createUser({
          name,
          email,
          passwordHash: hashPassword('oauth-user', config.jwtSecret),
        });
        user.emailVerified = true;
      }

      const session = store.createSession(user.id);

      return jsonResponse(200, {
        token: session.token,
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
        },
        expiresAt: session.expiresAt,
      });
    }
  } catch (error) {
    console.error('Google OAuth error:', error);
    return jsonResponse(400, {
      error: {
        code: 'OAUTH_ERROR',
        message: 'Google authentication failed. ' + (error instanceof Error ? error.message : 'Unknown error'),
        requestId,
      },
    });
  }
}

async function handleGitHubCallback({ request, config, store, requestId }) {
  const body = await parseJsonBody(request);
  const code = String(body.code ?? '').trim();
  const redirectUri = String(body.redirectUri ?? '').trim() || `${config.baseUrl}/auth/github/callback`;

  if (!code) {
    return jsonResponse(400, {
      error: {
        code: 'INVALID_INPUT',
        message: 'Authorization code is required',
        requestId,
      },
    });
  }

  try {
    // Real OAuth: Exchange code for token with GitHub
    if (config.githubClientId && config.githubClientSecret && config.githubClientId !== 'your-github-client-id-here') {
      const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify({
          code,
          client_id: config.githubClientId,
          client_secret: config.githubClientSecret,
          redirect_uri: redirectUri,
        }),
      });

      if (!tokenResponse.ok) {
        throw new Error('Failed to exchange GitHub token');
      }

      const { access_token } = await tokenResponse.json();

      // Get user info from GitHub
      const userResponse = await fetch('https://api.github.com/user', {
        headers: { Authorization: `Bearer ${access_token}` },
      });

      if (!userResponse.ok) {
        throw new Error('Failed to fetch GitHub user info');
      }

      const githubUser = await userResponse.json();
      
      // Get user email from GitHub
      let email = githubUser.email;
      if (!email) {
        const emailResponse = await fetch('https://api.github.com/user/emails', {
          headers: { Authorization: `Bearer ${access_token}` },
        });
        if (emailResponse.ok) {
          const emails = await emailResponse.json();
          const primaryEmail = emails.find((e) => e.primary);
          email = primaryEmail?.email || `${githubUser.login}@github.noreply.com`;
        }
      }

      email = email.toLowerCase();
      const name = githubUser.name || githubUser.login;

      let user = store.getUserByEmail(email);
      if (!user) {
        user = store.createUser({
          name,
          email,
          passwordHash: hashPassword('oauth-user', config.jwtSecret),
        });
        // Mark email as verified for OAuth users
        user.emailVerified = true;
      }

      const session = store.createSession(user.id);

      return jsonResponse(200, {
        token: session.token,
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
        },
        expiresAt: session.expiresAt,
      });
    } else {
      // Demo mode: Create or find demo user
      const email = `github-${randomUUID().slice(0, 8)}@demo.helix.app`;
      const name = 'GitHub User';

      let user = store.getUserByEmail(email);
      if (!user) {
        user = store.createUser({
          name,
          email,
          passwordHash: hashPassword('oauth-user', config.jwtSecret),
        });
        user.emailVerified = true;
      }

      const session = store.createSession(user.id);

      return jsonResponse(200, {
        token: session.token,
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
        },
        expiresAt: session.expiresAt,
      });
    }
  } catch (error) {
    console.error('GitHub OAuth error:', error);
    return jsonResponse(400, {
      error: {
        code: 'OAUTH_ERROR',
        message: 'GitHub authentication failed. ' + (error instanceof Error ? error.message : 'Unknown error'),
        requestId,
      },
    });
  }
}

async function handlePasswordResetRequest({ request, config, store, passwordResetRateLimiter, requestId }) {
  const body = await parseJsonBody(request);
  const email = String(body.email ?? '').trim().toLowerCase();

  // Rate limiting per email
  if (passwordResetRateLimiter.isLimited(`reset:${email}`, 3, 60 * 60 * 1000)) {
    return jsonResponse(429, {
      error: {
        code: 'RATE_LIMITED',
        message: 'Too many password reset requests. Please try again later.',
        requestId,
      },
    });
  }

  if (!email) {
    return jsonResponse(400, {
      error: {
        code: 'INVALID_INPUT',
        message: 'Email is required',
        requestId,
      },
    });
  }

  const user = store.getUserByEmail(email);
  if (!user) {
    // Don't reveal if user exists (security best practice)
    return jsonResponse(200, {
      message: 'If an account exists with this email, a reset link has been sent.',
    });
  }

  // Generate reset token
  const resetToken = `reset_${randomUUID()}`;
  store.createPasswordReset(email, resetToken);

  // Send password reset email
  try {
    await sendPasswordResetEmail(email, resetToken, config.baseUrl);
  } catch (error) {
    console.error('Failed to send password reset email:', error);
    // Continue anyway - email is optional in demo mode
  }

  const response = {
    message: 'Password reset link sent to your email.',
  };

  if (config.emailProvider === 'demo') {
    response.message += ' Demo token: ' + resetToken;
  }

  return jsonResponse(200, response);
}

async function handlePasswordResetComplete({ request, config, store, requestId }) {
  const body = await parseJsonBody(request);
  const token = String(body.token ?? '').trim();
  const password = String(body.password ?? '');

  if (!token || password.length < 8) {
    return jsonResponse(400, {
      error: {
        code: 'INVALID_INPUT',
        message: 'Valid token and password of at least 8 characters are required',
        requestId,
      },
    });
  }

  // Validate password complexity
  const passwordValidation = validatePasswordComplexity(password);
  if (!passwordValidation.isValid) {
    return jsonResponse(400, {
      error: {
        code: 'WEAK_PASSWORD',
        message: 'Password does not meet complexity requirements',
        details: passwordValidation.errors,
        strength: passwordValidation.strength,
        requestId,
      },
    });
  }

  // Verify reset token exists
  const resetRecord = store.getPasswordReset(token);
  if (!resetRecord) {
    return jsonResponse(400, {
      error: {
        code: 'INVALID_TOKEN',
        message: 'Password reset token is invalid or expired',
        requestId,
      },
    });
  }

  const user = store.getUserByEmail(resetRecord.email);
  if (!user) {
    return jsonResponse(400, {
      error: {
        code: 'USER_NOT_FOUND',
        message: 'User not found',
        requestId,
      },
    });
  }

  // Update password
  user.passwordHash = hashPassword(password, config.jwtSecret);
  store.deletePasswordReset(token);

  return jsonResponse(200, {
    message: 'Password has been reset successfully',
  });
}

async function handleVerifyEmail({ request, store, requestId }) {
  const body = await parseJsonBody(request);
  const token = String(body.token ?? '').trim();

  if (!token) {
    return jsonResponse(400, {
      error: {
        code: 'INVALID_INPUT',
        message: 'Verification token is required',
        requestId,
      },
    });
  }

  const user = store.verifyEmail(token);
  if (!user) {
    return jsonResponse(400, {
      error: {
        code: 'INVALID_TOKEN',
        message: 'Email verification token is invalid or expired',
        requestId,
      },
    });
  }

  return jsonResponse(200, {
    message: 'Email verified successfully. You can now login.',
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      emailVerified: user.emailVerified,
    },
  });
}

export default createApp;
