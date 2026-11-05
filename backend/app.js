import { randomUUID } from 'node:crypto';

import { loadConfig } from './config.js';
import { createMemoryStore } from './storage.js';
import { initializeEmailService, sendVerificationEmail, sendPasswordResetEmail } from './email.js';
import { RateLimiter } from './rate-limiter.js';
import { validatePasswordComplexity } from './password-validator.js';
import { analyzeProjectBrief, respondToVoiceTurn, transcribeVoiceNote } from './ai.js';
import { extractRawText } from 'mammoth';
import { PDFParse } from 'pdf-parse';
import { createAiSubsystem } from './ai/index.js';
import { hashPassword, verifyPassword } from './passwords.js';
import { WorkflowStateError } from './ai/orchestrator.js';

const DEFAULT_SECRET = 'development-secret-change-me';

class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/**
 * Connects the AI subsystem to the persistent store: restores saved workflows, artifacts and
 * traces, persists every subsequent change, and mirrors workflow progress onto the project record.
 */
export function bindAiToStore(ai, store) {
  ai.contextManager.hydrate?.(store.listWorkspaces());
  ai.contextManager.setPersistence?.((workspace) => store.saveWorkspace(workspace));
  ai.observability.hydrate?.(store.listTraces());
  ai.observability.onSpanCompleted = (span) => store.saveTrace(span);
  ai.orchestrator.attachStorage?.({
    saveWorkflow(workflow) {
      store.saveWorkflow(workflow);
      const project = store.getProjectById(workflow.projectId);
      if (!project) return;
      const status = {
        pending: 'Planning', running: 'In Progress', awaiting_approval: 'Awaiting Approval',
        completed: 'Completed', failed: 'Failed', cancelled: 'Cancelled',
      }[workflow.status] ?? project.status;
      if (project.progress !== workflow.progress || project.status !== status || project.workflowId !== workflow.id) {
        store.updateProject(project.id, { progress: workflow.progress ?? 0, status, workflowId: workflow.id, workflowStatus: workflow.status });
      }
    },
  }, store.listWorkflows());
}

function resolveCorsOrigin(config, origin) {
  if (!origin) return null;
  if (config.corsOrigins.includes('*')) return '*';
  return config.corsOrigins.includes(origin) ? origin : null;
}

function applyStandardHeaders(response, { config, request, requestId }) {
  const headers = response.headers;
  const allowed = resolveCorsOrigin(config, request.headers.get('origin'));
  if (allowed) {
    headers.set('Access-Control-Allow-Origin', allowed);
    headers.set('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
    headers.set('Access-Control-Allow-Headers', 'Content-Type,Authorization');
    headers.set('Access-Control-Expose-Headers', 'x-request-id,x-correlation-id');
    if (allowed !== '*') headers.append('Vary', 'Origin');
  }
  headers.set('x-content-type-options', 'nosniff');
  headers.set('x-frame-options', 'DENY');
  headers.set('referrer-policy', 'no-referrer');
  headers.set('x-request-id', requestId);
  headers.set('x-correlation-id', requestId);
  return response;
}

export function createApp(overrides = {}) {
  const config = loadConfig(overrides.env ?? process.env);
  if (config.nodeEnv === 'production' && (!config.jwtSecret || config.jwtSecret === DEFAULT_SECRET || config.jwtSecret.startsWith('change-me'))) {
    throw new Error('JWT_SECRET must be set to a strong random value in production.');
  }
  const store = createMemoryStore({ storagePath: overrides.storagePath ?? config.storagePath });
  const ai = overrides.ai ?? createAiSubsystem(config);
  bindAiToStore(ai, store);
  const loginRateLimiter = new RateLimiter();
  const registerRateLimiter = new RateLimiter();
  const passwordResetRateLimiter = new RateLimiter();

  // Initialize email service
  initializeEmailService(config);

  const app = {
    config,
    store,
    ai,
    loginRateLimiter,
    registerRateLimiter,
    passwordResetRateLimiter,
    async request(input, init = {}) {
      const request = input instanceof Request ? input : new Request(input, init);
      const requestId = randomUUID();
      let response;
      try {
        const declaredLength = Number(request.headers.get('content-length') ?? 0);
        if (declaredLength > config.maxBodyBytes) {
          throw new HttpError(413, 'PAYLOAD_TOO_LARGE', `Request body exceeds ${config.maxBodyBytes} bytes`);
        }
        response = await handleRequest({ request, config, store, ai, loginRateLimiter, registerRateLimiter, passwordResetRateLimiter, requestId });
      } catch (error) {
        if (error instanceof HttpError) {
          response = jsonResponse(error.status, { error: { code: error.code, message: error.message, requestId } });
        } else {
          console.error(`[${requestId}] Unhandled error:`, error);
          response = jsonResponse(500, { error: { code: 'INTERNAL_SERVER_ERROR', message: 'Unexpected server error', requestId } });
        }
      }
      return applyStandardHeaders(response, { config, request, requestId });
    },
    close() {
      store.flush();
    },
  };

  app.fetch = app.request.bind(app);
  return app;
}

async function handleRequest({ request, config, store, ai, loginRateLimiter, registerRateLimiter, passwordResetRateLimiter, requestId }) {
  const url = new URL(request.url);
  const path = url.pathname;

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: { 'Access-Control-Max-Age': '600' } });
  }

  if (request.method === 'GET' && path === '/api/v1/health') {
    return jsonResponse(200, {
      ok: true,
      service: 'helix-core',
      status: 'healthy',
      requestId,
      environment: config.nodeEnv,
      storage: store.mode ?? (config.storagePath === ':memory:' ? 'memory' : 'file'),
      ai: ai.modelRouter?.getStatus?.() ?? null,
      timestamp: new Date().toISOString(),
    });
  }

  if (request.method === 'GET' && path === '/api/v1/auth/me') {
    return handleGetMe({ request, store, requestId });
  }

  if (request.method === 'PATCH' && path === '/api/v1/auth/me') {
    return handleUpdateMe({ request, store, requestId });
  }

  if (request.method === 'POST' && path === '/api/v1/auth/logout') {
    return handleLogout({ request, store, requestId });
  }

  if (request.method === 'POST' && path === '/api/v1/auth/change-password') {
    return handleChangePassword({ request, config, store, requestId });
  }

  if (request.method === 'POST' && path === '/api/v1/auth/register') {
    return handleRegister({ request, config, store, registerRateLimiter, requestId });
  }

  if (request.method === 'POST' && path === '/api/v1/auth/login') {
    return handleLogin({ request, config, store, loginRateLimiter, requestId });
  }

  if (request.method === 'POST' && path === '/api/v1/auth/demo') {
    return handleDemoLogin({ request, config, store, requestId });
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

  // AI Workflow and Office routes
  if (request.method === 'POST' && /^\/api\/v1\/projects\/[^/]+\/workflows$/.test(path)) {
    return handleStartProjectWorkflow({ request, store, ai, requestId, path });
  }

  if (request.method === 'GET' && /^\/api\/v1\/projects\/[^/]+\/workflows\/stream$/.test(path)) {
    return handleWorkflowEventsStream({ request, store, ai, requestId, path });
  }

  if (request.method === 'GET' && /^\/api\/v1\/projects\/[^/]+\/workflows$/.test(path)) {
    return handleGetProjectWorkflow({ request, store, ai, requestId, path });
  }

  if (request.method === 'GET' && /^\/api\/v1\/projects\/[^/]+\/office$/.test(path)) {
    return handleGetProjectOffice({ request, store, ai, requestId, path });
  }

  if (request.method === 'GET' && /^\/api\/v1\/projects\/[^/]+\/artifacts$/.test(path)) {
    return handleGetProjectArtifacts({ request, store, ai, requestId, path });
  }

  if (request.method === 'POST' && /^\/api\/v1\/workflows\/[^/]+\/approve$/.test(path)) {
    return handleApproveWorkflowCheckpoint({ request, store, ai, requestId, path });
  }

  if (request.method === 'POST' && /^\/api\/v1\/workflows\/[^/]+\/retry$/.test(path)) {
    return handleRetryWorkflow({ request, store, ai, requestId, path });
  }

  if (request.method === 'POST' && /^\/api\/v1\/workflows\/[^/]+\/cancel$/.test(path)) {
    return handleCancelWorkflow({ request, store, ai, requestId, path });
  }

  if (request.method === 'PATCH' && /^\/api\/v1\/projects\/[^/]+$/.test(path)) {
    return handleUpdateProject({ request, store, ai, requestId, path });
  }

  if (request.method === 'GET' && /^\/api\/v1\/workflows\/[^/]+\/traces$/.test(path)) {
    return handleGetWorkflowTraces({ request, store, ai, requestId, path });
  }

  if (request.method === 'DELETE' && /^\/api\/v1\/projects\//.test(path)) {
    return handleDeleteProject({ request, store, ai, requestId, path });
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
      ...headers,
    },
  });
}

async function parseJsonBody(request) {
  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    return {};
  }

  const text = await request.text();
  if (!text) return {};
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    throw new HttpError(400, 'INVALID_JSON', 'Request body is not valid JSON');
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

function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    emailVerified: Boolean(user.emailVerified),
    authProvider: user.authProvider ?? 'password',
    createdAt: user.createdAt,
  };
}

function bearerToken(request) {
  const header = request.headers.get('authorization') ?? '';
  return header.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : null;
}

function requireProjectAccess(request, store, projectId, requestId) {
  const auth = requireAuth(request, store);
  if ('error' in auth) return auth;
  const project = store.getProjectById(projectId);
  if (!project) {
    return { error: jsonResponse(404, { error: { code: 'NOT_FOUND', message: 'Project not found', requestId } }) };
  }
  if (project.ownerId !== auth.user.id) {
    return { error: jsonResponse(403, { error: { code: 'FORBIDDEN', message: 'You do not have access to this project', requestId } }) };
  }
  return { ...auth, project };
}

function requireWorkflowAccess(request, store, ai, workflowId, requestId) {
  const workflow = ai.orchestrator.getWorkflow(workflowId);
  const auth = requireAuth(request, store);
  if ('error' in auth) return auth;
  const project = workflow ? store.getProjectById(workflow.projectId) : null;
  // Same 404 for missing and foreign workflows so IDs cannot be probed.
  if (!workflow || !project || project.ownerId !== auth.user.id) {
    return { error: jsonResponse(404, { error: { code: 'NOT_FOUND', message: 'Workflow not found', requestId } }) };
  }
  return { ...auth, workflow, project };
}

function workflowErrorResponse(error, requestId, fallbackCode) {
  if (error instanceof WorkflowStateError) {
    const status = error.code === 'WORKFLOW_NOT_FOUND' ? 404 : 409;
    return jsonResponse(status, { error: { code: error.code, message: error.message, requestId } });
  }
  return jsonResponse(400, { error: { code: fallbackCode, message: error.message, requestId } });
}

async function waitBriefly(promise, ms) {
  let timer;
  await Promise.race([
    promise.catch(() => null),
    new Promise((resolve) => { timer = setTimeout(resolve, ms); }),
  ]);
  clearTimeout(timer);
}

async function handleGetMe({ request, store, requestId }) {
  const auth = requireAuth(request, store);
  if ('error' in auth) return auth.error;
  return jsonResponse(200, { user: publicUser(auth.user), session: { expiresAt: auth.session.expiresAt, rememberMe: auth.session.rememberMe } }, { 'x-correlation-id': requestId });
}

async function handleUpdateMe({ request, store, requestId }) {
  const auth = requireAuth(request, store);
  if ('error' in auth) return auth.error;
  const body = await parseJsonBody(request);
  const name = String(body.name ?? '').trim();
  if (!name || name.length > 120) {
    return jsonResponse(400, { error: { code: 'INVALID_INPUT', message: 'Name must be between 1 and 120 characters', requestId } });
  }
  const user = store.updateUser(auth.user.id, { name });
  return jsonResponse(200, { user: publicUser(user) }, { 'x-correlation-id': requestId });
}

async function handleLogout({ request, store, requestId }) {
  const token = bearerToken(request);
  if (token) store.deleteSession(token);
  return jsonResponse(200, { message: 'Logged out' }, { 'x-correlation-id': requestId });
}

async function handleChangePassword({ request, config, store, requestId }) {
  const auth = requireAuth(request, store);
  if ('error' in auth) return auth.error;
  const body = await parseJsonBody(request);
  const currentPassword = String(body.currentPassword ?? '');
  const newPassword = String(body.newPassword ?? '');

  const check = await verifyPassword(currentPassword, auth.user.passwordHash, config.jwtSecret);
  if (!check.valid) {
    return jsonResponse(401, { error: { code: 'INVALID_CREDENTIALS', message: 'Current password is incorrect', requestId } });
  }
  const validation = validatePasswordComplexity(newPassword);
  if (!validation.isValid) {
    return jsonResponse(400, { error: { code: 'WEAK_PASSWORD', message: 'Password does not meet complexity requirements', details: validation.errors, requestId } });
  }
  store.updateUser(auth.user.id, { passwordHash: await hashPassword(newPassword) });
  // Revoke every other session for this user.
  const currentToken = bearerToken(request);
  for (const [token, session] of store.sessions) {
    if (session.userId === auth.user.id && token !== currentToken) store.sessions.delete(token);
  }
  store.persist();
  return jsonResponse(200, { message: 'Password updated' }, { 'x-correlation-id': requestId });
}

async function handleUpdateProject({ request, store, ai, requestId, path }) {
  const projectId = path.split('/')[4];
  const access = requireProjectAccess(request, store, projectId, requestId);
  if ('error' in access) return access.error;
  const body = await parseJsonBody(request);
  const patch = {};
  if (body.name !== undefined) {
    const name = String(body.name).trim();
    if (!name || name.length > 120) {
      return jsonResponse(400, { error: { code: 'INVALID_INPUT', message: 'Project name must be between 1 and 120 characters', requestId } });
    }
    patch.name = name;
  }
  if (body.description !== undefined) {
    const description = String(body.description).trim();
    if (description.length > 4000) {
      return jsonResponse(400, { error: { code: 'INVALID_INPUT', message: 'Description must be at most 4000 characters', requestId } });
    }
    patch.description = description;
  }
  for (const key of ['keyFeatures', 'techStack']) {
    if (body[key] !== undefined) {
      if (!Array.isArray(body[key])) {
        return jsonResponse(400, { error: { code: 'INVALID_INPUT', message: `${key} must be an array of strings`, requestId } });
      }
      patch[key] = body[key].map((v) => String(v).trim()).filter(Boolean).slice(0, 30);
    }
  }
  if (Object.keys(patch).length === 0) {
    return jsonResponse(400, { error: { code: 'INVALID_INPUT', message: 'No updatable fields provided', requestId } });
  }
  const project = store.updateProject(projectId, patch);
  store.persist();
  ai.contextManager.updateProjectInfo?.(projectId, patch);
  return jsonResponse(200, project, { 'x-correlation-id': requestId });
}

async function handleRetryWorkflow({ request, store, ai, requestId, path }) {
  const access = requireWorkflowAccess(request, store, ai, path.split('/')[4], requestId);
  if ('error' in access) return access.error;
  try {
    const { workflow } = ai.orchestrator.retryWorkflow(access.workflow.id);
    return jsonResponse(202, workflow, { 'x-correlation-id': requestId });
  } catch (error) {
    return workflowErrorResponse(error, requestId, 'RETRY_FAILED');
  }
}

async function handleCancelWorkflow({ request, store, ai, requestId, path }) {
  const access = requireWorkflowAccess(request, store, ai, path.split('/')[4], requestId);
  if ('error' in access) return access.error;
  try {
    const workflow = ai.orchestrator.cancelWorkflow(access.workflow.id);
    return jsonResponse(200, workflow, { 'x-correlation-id': requestId });
  } catch (error) {
    return workflowErrorResponse(error, requestId, 'CANCEL_FAILED');
  }
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
    passwordHash: await hashPassword(password),
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
  const passwordCheck = user ? await verifyPassword(password, user.passwordHash, config.jwtSecret) : { valid: false };
  if (!user || !passwordCheck.valid) {
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

  if (passwordCheck.needsRehash) {
    store.updateUser(user.id, { passwordHash: await hashPassword(password) });
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

async function handleDemoLogin({ config, store, requestId }) {
  if (!config.demoLoginEnabled) {
    return jsonResponse(403, { error: { code: 'DEMO_DISABLED', message: 'Demo login is disabled on this deployment', requestId } });
  }
  const email = 'demo@helix.app';
  let user = store.getUserByEmail(email);
  if (!user) {
    user = store.createUser({
      name: 'Demo Engineer',
      email,
      passwordHash: null,
      emailVerified: true,
      authProvider: 'demo',
    });
  }
  if (!user.emailVerified) store.updateUser(user.id, { emailVerified: true, emailVerificationToken: null });
  const session = store.createSession(user.id, true);

  return jsonResponse(200, {
    token: session.token,
    user: publicUser(user),
    expiresAt: session.expiresAt,
    rememberMe: true,
  }, { 'x-correlation-id': requestId });
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

async function handleDeleteProject({ request, store, ai, requestId, path }) {
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

  ai.orchestrator.removeProject?.(projectId);
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

function isConfiguredCredential(value) {
  return Boolean(value) && !/^your-|-here$/i.test(value);
}

function upsertOAuthUser(store, { email, name, provider, emailVerified }) {
  let user = store.getUserByEmail(email);
  if (!user) {
    // OAuth accounts have no password; password login is impossible until a reset sets one.
    user = store.createUser({ name, email, passwordHash: null, emailVerified, authProvider: provider });
  } else if (emailVerified && !user.emailVerified) {
    store.updateUser(user.id, { emailVerified: true, emailVerificationToken: null });
  }
  return user;
}

async function handleOAuthCallback({ request, config, store, requestId, provider }) {
  const body = await parseJsonBody(request);
  const code = String(body.code ?? '').trim();
  const redirectUri = String(body.redirectUri ?? '').trim() || `${config.baseUrl}/auth/${provider}/callback`;
  const codeVerifier = String(body.codeVerifier ?? '').trim();
  const label = provider === 'google' ? 'Google' : 'GitHub';

  if (!code) {
    return jsonResponse(400, { error: { code: 'INVALID_INPUT', message: 'Authorization code is required', requestId } });
  }

  const clientId = provider === 'google' ? config.googleClientId : config.githubClientId;
  const clientSecret = provider === 'google' ? config.googleClientSecret : config.githubClientSecret;
  if (!isConfiguredCredential(clientId) || !isConfiguredCredential(clientSecret)) {
    return jsonResponse(501, {
      error: { code: 'OAUTH_NOT_CONFIGURED', message: `${label} sign-in is not configured on this server`, requestId },
    });
  }

  try {
    let profile;
    if (provider === 'google') {
      const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: redirectUri,
          grant_type: 'authorization_code',
          ...(codeVerifier ? { code_verifier: codeVerifier } : {}),
        }),
        signal: AbortSignal.timeout(10000),
      });
      if (!tokenResponse.ok) throw new Error('Failed to exchange Google token');
      const { access_token } = await tokenResponse.json();
      const userResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { Authorization: `Bearer ${access_token}` },
        signal: AbortSignal.timeout(10000),
      });
      if (!userResponse.ok) throw new Error('Failed to fetch Google user info');
      const googleUser = await userResponse.json();
      if (!googleUser.email) throw new Error('Google account has no email address');
      profile = { email: googleUser.email.toLowerCase(), name: googleUser.name || 'Google User', emailVerified: googleUser.verified_email !== false };
    } else {
      const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri }),
        signal: AbortSignal.timeout(10000),
      });
      if (!tokenResponse.ok) throw new Error('Failed to exchange GitHub token');
      const { access_token, error_description } = await tokenResponse.json();
      if (!access_token) throw new Error(error_description || 'GitHub did not return an access token');
      const headers = { Authorization: `Bearer ${access_token}`, 'User-Agent': 'helix' };
      const userResponse = await fetch('https://api.github.com/user', { headers, signal: AbortSignal.timeout(10000) });
      if (!userResponse.ok) throw new Error('Failed to fetch GitHub user info');
      const githubUser = await userResponse.json();
      const emailResponse = await fetch('https://api.github.com/user/emails', { headers, signal: AbortSignal.timeout(10000) });
      const emails = emailResponse.ok ? await emailResponse.json() : [];
      const primary = Array.isArray(emails) ? emails.find((e) => e.primary && e.verified) : null;
      const email = primary?.email || githubUser.email;
      if (!email) throw new Error('GitHub account has no verified email address');
      profile = { email: email.toLowerCase(), name: githubUser.name || githubUser.login, emailVerified: Boolean(primary) };
    }

    const user = upsertOAuthUser(store, { ...profile, provider });
    const session = store.createSession(user.id);
    return jsonResponse(200, { token: session.token, user: publicUser(user), expiresAt: session.expiresAt });
  } catch (error) {
    console.error(`${label} OAuth error:`, error);
    return jsonResponse(400, {
      error: { code: 'OAUTH_ERROR', message: `${label} authentication failed. ${error instanceof Error ? error.message : 'Unknown error'}`, requestId },
    });
  }
}

async function handleGoogleCallback(context) {
  return handleOAuthCallback({ ...context, provider: 'google' });
}

async function handleGitHubCallback(context) {
  return handleOAuthCallback({ ...context, provider: 'github' });
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

  if (config.emailProvider === 'demo' && config.nodeEnv !== 'production') {
    response.message += ' Demo token: ' + resetToken;
    response.resetToken = resetToken;
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
  store.updateUser(user.id, { passwordHash: await hashPassword(password) });
  store.deletePasswordReset(token);
  store.deleteSessionsForUser(user.id);

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

async function handleStartProjectWorkflow({ request, store, ai, requestId, path }) {
  const projectId = path.split('/')[4];
  const access = requireProjectAccess(request, store, projectId, requestId);
  if ('error' in access) return access.error;
  const body = await parseJsonBody(request);

  let workflow = ai.orchestrator.getWorkflowForProject(projectId);
  let created = false;
  try {
    if (!workflow || (body.restart === true && ['completed', 'failed', 'cancelled'].includes(workflow.status))) {
      workflow = await ai.orchestrator.createWorkflow(projectId, access.project);
      created = true;
    }
  } catch (error) {
    return workflowErrorResponse(error, requestId, 'WORKFLOW_START_FAILED');
  }

  if (workflow.status === 'pending') {
    ai.orchestrator.runNextSteps(workflow.id).catch((err) => {
      console.error('[Orchestrator background execution error]:', err);
    });
  }

  return jsonResponse(created ? 201 : 200, workflow, { 'x-correlation-id': requestId });
}

async function handleGetProjectWorkflow({ request, store, ai, requestId, path }) {
  const projectId = path.split('/')[4];
  const access = requireProjectAccess(request, store, projectId, requestId);
  if ('error' in access) return access.error;

  const workflow = ai.orchestrator.getWorkflowForProject(projectId);
  if (!workflow) {
    return jsonResponse(404, { error: { code: 'NO_WORKFLOW', message: 'No workflow has been started for this project', requestId } });
  }
  return jsonResponse(200, workflow, { 'x-correlation-id': requestId });
}

async function handleGetProjectOffice({ request, store, ai, requestId, path }) {
  const projectId = path.split('/')[4];
  const access = requireProjectAccess(request, store, projectId, requestId);
  if ('error' in access) return access.error;
  return jsonResponse(200, ai.orchestrator.getOfficeFloorState(projectId), { 'x-correlation-id': requestId });
}

async function handleGetProjectArtifacts({ request, store, ai, requestId, path }) {
  const projectId = path.split('/')[4];
  const access = requireProjectAccess(request, store, projectId, requestId);
  if ('error' in access) return access.error;
  const artifacts = ai.contextManager.getArtifacts(projectId);
  return jsonResponse(200, { artifacts }, { 'x-correlation-id': requestId });
}

async function handleApproveWorkflowCheckpoint({ request, store, ai, requestId, path }) {
  const access = requireWorkflowAccess(request, store, ai, path.split('/')[4], requestId);
  if ('error' in access) return access.error;

  const body = await parseJsonBody(request);
  const checkpointType = String(body.checkpointType || '');
  const approved = body.approved !== false;
  const revise = body.revise === true;
  const comments = String(body.comments || '').slice(0, 4000);

  try {
    const workflow = ai.orchestrator.decideCheckpoint(access.workflow.id, checkpointType, { approved, comments, revise });
    if (approved && workflow.status === 'running') {
      const run = ai.orchestrator.runNextSteps(workflow.id);
      run.catch((err) => console.error('[Orchestrator background execution error]:', err));
      // Fast pipelines (e.g. local/mock models) report their next state directly; slow ones continue in the background.
      await waitBriefly(run, 1500);
    }
    return jsonResponse(200, ai.orchestrator.getWorkflow(workflow.id), { 'x-correlation-id': requestId });
  } catch (error) {
    return workflowErrorResponse(error, requestId, 'APPROVAL_FAILED');
  }
}

async function handleGetWorkflowTraces({ request, store, ai, requestId, path }) {
  const access = requireWorkflowAccess(request, store, ai, path.split('/')[4], requestId);
  if ('error' in access) return access.error;

  const traces = ai.observability.getTracesForWorkflow(access.workflow.id);
  const metrics = ai.observability.getWorkflowMetrics(access.workflow.id);
  return jsonResponse(200, { metrics, traces }, { 'x-correlation-id': requestId });
}

async function handleWorkflowEventsStream({ request, store, ai, requestId, path }) {
  const url = new URL(request.url);
  // EventSource cannot send headers, so the session token may arrive as a query parameter.
  const token = url.searchParams.get('token') || bearerToken(request);
  if (!token) {
    return jsonResponse(401, { error: { code: 'UNAUTHORIZED', message: 'Missing token', requestId } });
  }
  const authed = new Request(request.url, { headers: { authorization: `Bearer ${token}` } });
  const projectId = path.split('/')[4];
  const access = requireProjectAccess(authed, store, projectId, requestId);
  if ('error' in access) return access.error;

  let cleanup = null;
  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      let closed = false;
      const write = (text) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          cleanup?.();
        }
      };
      const sendData = (payload) => write(`id: ${payload.id ?? randomUUID()}\ndata: ${JSON.stringify(payload)}\n\n`);

      write('retry: 3000\n\n');
      sendData({ type: 'connected', projectId, timestamp: new Date().toISOString() });
      sendData({ type: 'office_snapshot', timestamp: new Date().toISOString(), payload: ai.orchestrator.getOfficeFloorState(projectId) });

      const listener = (event) => {
        const eventProjectId = event.payload?.projectId
          ?? ai.orchestrator.getWorkflow(event.payload?.workflowId)?.projectId;
        if (eventProjectId === projectId) sendData(event);
      };
      ai.observability.on('workflow_event', listener);

      const heartbeatTimer = setInterval(() => write(': heartbeat\n\n'), 15000);
      heartbeatTimer.unref?.();

      cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeatTimer);
        ai.observability.off('workflow_event', listener);
      };
    },
    cancel() {
      cleanup?.();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}

export default createApp;
