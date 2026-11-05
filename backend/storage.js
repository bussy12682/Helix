import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export function createMemoryStore({ storagePath = ":memory:" } = {}) {
  const users = new Map();
  const sessions = new Map();
  const projects = new Map();
  const passwordResets = new Map();
  const workflows = new Map();
  const workspaces = new Map();
  const traces = new Map();
  let persistTimer = null;

  // Atomic write: serialize to a temp file then rename so a crash never leaves a truncated state file.
  function persist() {
    if (persistTimer) {
      clearTimeout(persistTimer);
      persistTimer = null;
    }
    if (storagePath === ":memory:") return;

    const state = {
      version: 2,
      users: [...users.values()],
      sessions: [...sessions.values()],
      projects: [...projects.values()],
      passwordResets: [...passwordResets.values()],
      workflows: [...workflows.values()],
      workspaces: [...workspaces.values()],
      traces: [...traces.entries()].map(([workflowId, spans]) => ({ workflowId, spans })),
    };
    mkdirSync(dirname(storagePath), { recursive: true });
    const tempPath = `${storagePath}.${process.pid}.tmp`;
    writeFileSync(tempPath, JSON.stringify(state), "utf8");
    renameSync(tempPath, storagePath);
  }

  // Coalesces high-frequency updates (task progress, traces) into a single write.
  function persistSoon(delayMs = 250) {
    if (storagePath === ":memory:" || persistTimer) return;
    persistTimer = setTimeout(() => {
      persistTimer = null;
      try {
        persist();
      } catch (error) {
        console.error("[storage] Deferred persist failed:", error);
      }
    }, delayMs);
    persistTimer.unref?.();
  }

  function flush() {
    if (persistTimer) persist();
  }

  if (storagePath !== ":memory:" && existsSync(storagePath)) {
    try {
      const state = JSON.parse(readFileSync(storagePath, "utf8"));
      for (const user of state.users ?? []) users.set(user.id, user);
      for (const session of state.sessions ?? []) sessions.set(session.token, session);
      for (const project of state.projects ?? []) projects.set(project.id, project);
      for (const reset of state.passwordResets ?? []) passwordResets.set(reset.token, reset);
      for (const workflow of state.workflows ?? []) workflows.set(workflow.id, workflow);
      for (const workspace of state.workspaces ?? [])
        workspaces.set(workspace.projectId, workspace);
      for (const entry of state.traces ?? []) traces.set(entry.workflowId, entry.spans ?? []);
    } catch (error) {
      console.error(
        `[storage] Could not read ${storagePath}; starting with an empty store.`,
        error.message,
      );
    }
  }

  function nextId(prefix) {
    return `${prefix}_${randomUUID()}`;
  }

  function createUser({
    name,
    email,
    passwordHash,
    emailVerified = false,
    authProvider = "password",
  }) {
    const id = nextId("user");
    const user = {
      id,
      name,
      email: email.toLowerCase(),
      passwordHash,
      authProvider,
      emailVerified,
      emailVerificationToken: null,
      createdAt: new Date().toISOString(),
    };
    users.set(id, user);
    persist();
    return user;
  }

  function getUserByEmail(email) {
    const normalized = String(email ?? "")
      .trim()
      .toLowerCase();
    return [...users.values()].find((user) => user.email === normalized) ?? null;
  }

  function getUserById(id) {
    return users.get(id) ?? null;
  }

  function updateUser(id, patch) {
    const user = users.get(id);
    if (!user) return null;
    Object.assign(user, patch, { updatedAt: new Date().toISOString() });
    persist();
    return user;
  }

  function deleteSession(token) {
    const deleted = sessions.delete(token);
    if (deleted) persist();
    return deleted;
  }

  function deleteSessionsForUser(userId) {
    let count = 0;
    for (const [token, session] of sessions) {
      if (session.userId === userId) {
        sessions.delete(token);
        count += 1;
      }
    }
    if (count) persist();
    return count;
  }

  function createSession(userId, rememberMe = false) {
    const token = `helix.${randomUUID()}`;
    // 8 hours default, 30 days if remembered
    const expirationMs = rememberMe ? 1000 * 60 * 60 * 24 * 30 : 1000 * 60 * 60 * 8;
    const session = {
      id: nextId("session"),
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

  function createProject({ ownerId, name, description = "", keyFeatures = [], techStack = [] }) {
    const id = nextId("project");
    const project = {
      id,
      ownerId,
      name,
      description,
      keyFeatures,
      techStack,
      status: "active",
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

  function updateProject(id, patch) {
    const project = projects.get(id);
    if (!project) return null;
    Object.assign(project, patch, { updatedAt: new Date().toISOString() });
    persistSoon();
    return project;
  }

  function deleteProject(id) {
    const deleted = projects.delete(id);
    if (deleted) {
      for (const [workflowId, workflow] of workflows) {
        if (workflow.projectId === id) {
          workflows.delete(workflowId);
          traces.delete(workflowId);
        }
      }
      workspaces.delete(id);
      persist();
    }
    return deleted;
  }

  function saveWorkflow(workflow) {
    workflows.set(workflow.id, workflow);
    persistSoon();
  }

  function listWorkflows() {
    return [...workflows.values()];
  }

  function saveWorkspace(workspace) {
    workspaces.set(workspace.projectId, workspace);
    persistSoon();
  }

  function listWorkspaces() {
    return [...workspaces.values()];
  }

  function saveTrace(span) {
    if (!span?.workflowId) return;
    const list = traces.get(span.workflowId) ?? [];
    list.push(span);
    if (list.length > 500) list.shift();
    traces.set(span.workflowId, list);
    persistSoon();
  }

  function listTraces() {
    return [...traces.values()].flat();
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
    workflows,
    mode: storagePath === ":memory:" ? "memory" : "file",
    nextId,
    persist,
    flush,
    updateUser,
    deleteSession,
    deleteSessionsForUser,
    updateProject,
    saveWorkflow,
    listWorkflows,
    saveWorkspace,
    listWorkspaces,
    saveTrace,
    listTraces,
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
