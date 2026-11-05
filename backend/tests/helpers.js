import { createApp } from "../app.js";
import { createAiSubsystem } from "../ai/index.js";

export function makeApp(options = {}) {
  const ai = options.ai ?? createAiSubsystem({ mockMode: true });
  const app = createApp({
    storagePath: options.storagePath ?? ":memory:",
    ai,
    env: options.env ?? {},
  });
  return { app, ai };
}

export async function call(app, method, path, { token, body, headers = {} } = {}) {
  const res = await app.request(`http://localhost${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: res.status, headers: res.headers, json };
}

export async function signUp(app, email, password = "Password123!", name = "Test User") {
  const reg = await call(app, "POST", "/api/v1/auth/register", { body: { name, email, password } });
  await call(app, "POST", "/api/v1/auth/verify-email", {
    body: { token: reg.json.verificationToken },
  });
  const login = await call(app, "POST", "/api/v1/auth/login", { body: { email, password } });
  return { token: login.json.token, user: login.json.user };
}

export async function createProject(app, token, name = "Test Project") {
  const res = await call(app, "POST", "/api/v1/projects", {
    token,
    body: {
      name,
      description: "A project used by automated tests",
      keyFeatures: ["Auth"],
      techStack: ["Node"],
    },
  });
  return res.json;
}

export async function waitFor(predicate, { timeoutMs = 5000, intervalMs = 10 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const value = await predicate();
    if (value) return value;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error("waitFor timed out");
}
