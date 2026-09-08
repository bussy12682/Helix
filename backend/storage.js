import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export function createMemoryStore({ storagePath = ':memory:' } = {}) {
  const users = new Map();
  const sessions = new Map();
  const projects = new Map();
  const passwordResets = new Map();

  function persist() {
    if (storagePath === ':memory:') return;

    const state = {
      users: [...users.values()],
      sessions: [...sessions.values()],
      projects: [...projects.values()],
      passwordResets: [...passwordResets.values()],
    };
    mkdirSync(dirname(storagePath), { recursive: true });
    writeFileSync(storagePath, JSON.stringify(state, null, 2), 'utf8');
  }

  if (storagePath !== ':memory:' && existsSync(storagePath)) {
    try {
      const state = JSON.parse(readFileSync(storagePath, 'utf8'));
      for (const user of state.users ?? []) users.set(user.id, user);
      for (const session of state.sessions ?? []) sessions.set(session.token, session);
      for (const project of state.projects ?? []) projects.set(project.id, project);
      for (const reset of state.passwordResets ?? []) passwordResets.set(reset.token, reset);
    } catch {
      // Start with an empty store if the local state file is missing or invalid.
    }
  }

  function nextId(prefix) {
    return `${prefix}_${randomUUID()}`;
  }

  function createUser({ name, email, passwordHash }) {
    const id = nextId('user');
    const user = {
      id,
      name,
      email: email.toLowerCase(),
      passwordHash,
      emailVerified: false,
      emailVerificationToken: null,
      createdAt: new Date().toISOString(),
    };
    users.set(id, user);
    persist();
    return user;
  }

  function getUserByEmail(email) {
    const normalized = String(email ?? '').trim().toLowerCase();
    return [...users.values()].find((user) => user.email === normalized) ?? null;
  }

  function getUserById(id) {
    return users.get(id) ?? null;
  }

  function createSession(userId, rememberMe = false) {
    const token = `helix.${randomUUID()}`;
    // 8 hours default, 30 days if remembered
    const expirationMs = rememberMe ? 1000 * 60 * 60 * 24 * 30 : 1000 * 60 * 60 * 8;
    const session = {
      id: nextId('session'),
      token,
      userId,
      rememberMe,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + expirationMs).toISOString(),
    };
    sessions.set(token, session);
    persist();
    return session;
  }

  function getSession(token) {
    const session = sessions.get(token) ?? null;
    if (!session) return null;

    // Check if session has expired
    if (new Date(session.expiresAt) < new Date()) {
      sessions.delete(token);
      persist();
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
      persist();
    }

    return {
      isValid: !isExpired,
      expired: isExpired,
      expiresAt: session.expiresAt,
      rememberMe: session.rememberMe,
    };
  }

  function createProject({ ownerId, name, description = '', keyFeatures = [], techStack = [] }) {
    const id = nextId('project');
    const project = {
      id,
      ownerId,
      name,
      description,
      keyFeatures,
      techStack,
      status: 'active',
      progress: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    projects.set(id, project);
    persist();
    return project;
  }

  function getProjectById(id) {
    return projects.get(id) ?? null;
  }

  function deleteProject(id) {
    const deleted = projects.delete(id);
    if (deleted) persist();
    return deleted;
  }

  function listProjectsForUser(userId) {
    return [...projects.values()].filter((project) => project.ownerId === userId);
  }

  function createPasswordReset(email, token) {
    const reset = {
      token,
      email: email.toLowerCase(),
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 1000 * 60 * 60).toISOString(), // 1 hour
    };
    passwordResets.set(token, reset);
    persist();
    return reset;
  }

  function getPasswordReset(token) {
    const reset = passwordResets.get(token);
    if (!reset) return null;

    // Check if token has expired
    if (new Date(reset.expiresAt) < new Date()) {
      passwordResets.delete(token);
      persist();
      return null;
    }

    return reset;
  }

  function deletePasswordReset(token) {
    passwordResets.delete(token);
    persist();
    return true;
  }

  function setEmailVerificationToken(userId, token) {
    const user = users.get(userId);
    if (user) {
      user.emailVerificationToken = token;
      persist();
    }
    return user;
  }

  function verifyEmail(token) {
    const user = [...users.values()].find((u) => u.emailVerificationToken === token);
    if (user) {
      user.emailVerified = true;
      user.emailVerificationToken = null;
      persist();
      return user;
    }
    return null;
  }

  function isEmailVerified(userId) {
    const user = users.get(userId);
    return user?.emailVerified ?? false;
  }

  return {
    users,
    sessions,
    projects,
    passwordResets,
    nextId,
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
  };
}

export default createMemoryStore;
