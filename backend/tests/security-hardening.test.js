/**
 * Security hardening tests (mission priority 4): opt-in httpOnly cookie
 * sessions, preview capability TTL, and regression-proofing the sandbox
 * controls documented in docs/SECURITY.md.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { createApp } from "../app.js";
import { makeApp, call, signUp, createProject } from "./helpers.js";

function tempDir(tag) {
  const dir = mkdtempSync(path.join(tmpdir(), `helix-sec-${tag}-`));
  process.on("exit", () => {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  });
  return dir;
}

test("cookie sessions are opt-in: no Set-Cookie unless HELIX_COOKIE_SESSIONS is enabled", async () => {
  const { app } = makeApp();
  await app.ready;
  const email = `nocookie-${crypto.randomUUID()}@example.com`;
  await signUp(app, email);
  const login = await call(app, "POST", "/api/v1/auth/login", {
    body: { email, password: "Password123!" },
  });
  assert.equal(login.status, 200);
  assert.equal(
    login.headers.get("set-cookie"),
    null,
    "cookies must never be issued without the opt-in",
  );
  await app.close();
});

test("enabled cookie sessions are httpOnly, SameSite=Lax, and authenticate API requests", async () => {
  const dir = tempDir("cookie");
  const app = createApp({
    storagePath: ":memory:",
    env: {
      HELIX_MOCK_AI: "true",
      HELIX_COOKIE_SESSIONS: "true",
      HELIX_WORKSPACE_ROOT: dir,
      CORS_ORIGINS: "https://app.example.com",
    },
  });
  await app.ready;
  const email = `cookie-${crypto.randomUUID()}@example.com`;
  await signUp(app, email);
  const login = await call(app, "POST", "/api/v1/auth/login", {
    body: { email, password: "Password123!", rememberMe: true },
    headers: { origin: "https://app.example.com" },
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.get("set-cookie");
  assert.ok(cookie, "login must set the session cookie when enabled and origin is allowed");
  assert.match(cookie, /helix_session=/);
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /SameSite=Lax/i);
  assert.match(cookie, /Max-Age=2592000/); // remember-me: 30 days

  // The cookie alone authenticates API calls (no bearer header).
  const me = await app.request("http://localhost/api/v1/auth/me", {
    headers: { cookie },
  });
  assert.equal(me.status, 200);
  assert.equal((await me.json()).user.email, email);

  // Logout revokes the session server-side and clears the cookie.
  const logout = await app.request("http://localhost/api/v1/auth/logout", {
    method: "POST",
    headers: { cookie },
  });
  assert.equal(logout.status, 200);
  assert.match(logout.headers.get("set-cookie") ?? "", /Max-Age=0/);
  const after = await app.request("http://localhost/api/v1/auth/me", { headers: { cookie } });
  assert.equal(after.status, 401, "a logged-out session cookie must stop working");
  await app.close();
});

test("cookies are not issued for disallowed origins", async () => {
  const { app } = makeApp({
    env: { HELIX_COOKIE_SESSIONS: "true", CORS_ORIGINS: "https://app.example.com" },
  });
  await app.ready;
  const email = `cross-${crypto.randomUUID()}@example.com`;
  await signUp(app, email);
  const login = await call(app, "POST", "/api/v1/auth/login", {
    body: { email, password: "Password123!" },
    headers: { origin: "https://evil.example" },
  });
  assert.equal(login.status, 200);
  assert.equal(login.headers.get("set-cookie"), null, "no cookie for a non-allowed origin");
  await app.close();
});

test("preview capabilities expire after the configured TTL and their token is rejected", async () => {
  const dir = tempDir("ttl");
  const { app } = makeApp({
    env: { HELIX_WORKSPACE_ROOT: dir, HELIX_PREVIEW_TTL_MS: "2000" },
  });
  await app.ready;
  const { token } = await signUp(app, `ttl-${crypto.randomUUID()}@example.com`);
  const project = await createProject(app, token, "TTL Preview");

  // A static preview requires an index.html on disk.
  await call(app, "PUT", `/api/v1/projects/${project.id}/files`, {
    token,
    body: { path: "index.html", content: "<!doctype html><title>p</title><h1>ok</h1>" },
  });
  const started = await call(app, "POST", `/api/v1/projects/${project.id}/preview/start`, {
    token,
    body: {},
  });
  assert.equal(started.status, 200, JSON.stringify(started.json));
  assert.equal(started.json.preview.status, "ready");
  const url = new URL(`http://localhost${started.json.preview.url}`);

  // Before expiry the capability works.
  const fresh = await app.request(`http://localhost${url.pathname}`, { headers: {} });
  assert.equal(fresh.status, 200);

  // After the TTL the token is rejected and the preview is expired.
  await new Promise((resolve) => setTimeout(resolve, 2300));
  const expiredStatus = await call(app, "GET", `/api/v1/projects/${project.id}/preview/status`, {
    token,
  });
  assert.equal(expiredStatus.json.preview.status, "expired");
  const expiredFetch = await app.request(`http://localhost${url.pathname}`);
  assert.equal(expiredFetch.status, 404, "an expired preview capability must be rejected");
  await app.close();
});

test("sandbox controls documented in docs/SECURITY.md are enforced in code", () => {
  const source = readFileSync(new URL("../execution-service.js", import.meta.url), "utf8");

  // Executable allowlist and absolute-path rejection.
  assert.match(source, /ALLOWED_EXECUTABLES = new Set\(\["node", "npm", "npx", "python3"\]\)/);
  assert.match(source, /args\[0\]\.includes\("\/"\)/);

  // Namespace isolation and capability drop.
  assert.match(source, /"--unshare-all"/);
  assert.match(source, /"--die-with-parent"/);
  assert.match(source, /"--new-session"/);
  assert.match(source, /"--cap-drop",\s*"ALL"/);

  // Resource ceilings.
  assert.match(source, /--as=4294967296/);
  assert.match(source, /--fsize=16777216/);
  assert.match(source, /--size",\s*"67108864"/);

  // Environment scrubbing: allowlist only, no process.env inheritance.
  assert.match(
    source,
    /SAFE_ENV_KEYS = new Set\(\["HOST", "PORT", "NODE_ENV", "npm_config_cache"\]\)/,
  );
  assert.ok(!/env:\s*process\.env/.test(source), "the sandbox env must never inherit process.env");

  // Network is opt-in per job.
  assert.match(source, /job\.allowNetwork\) bwrapArgs\.push\("--share-net"\)/);
});
