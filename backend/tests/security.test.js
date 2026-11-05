import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import { createApp } from "../app.js";
import { hashPassword, verifyPassword } from "../passwords.js";
import { makeApp, call, signUp, createProject, waitFor } from "./helpers.js";

test("passwords are stored with salted scrypt and verified correctly", async () => {
  const a = await hashPassword("Password123!");
  const b = await hashPassword("Password123!");
  assert.match(a, /^scrypt\$\d+\$[0-9a-f]{32}\$[0-9a-f]{128}$/);
  assert.notEqual(a, b, "salts must differ");
  assert.equal((await verifyPassword("Password123!", a)).valid, true);
  assert.equal((await verifyPassword("wrong", a)).valid, false);
  assert.equal((await verifyPassword("x", null)).valid, false);
});

test("legacy SHA-256 hashes still log in and are upgraded to scrypt", async () => {
  const { app } = makeApp();
  const secret = app.config.jwtSecret;
  const user = app.store.createUser({
    name: "Legacy",
    email: "legacy@helix.dev",
    passwordHash: createHash("sha256").update(`Password123!:${secret}`).digest("hex"),
    emailVerified: true,
  });
  const login = await call(app, "POST", "/api/v1/auth/login", {
    body: { email: "legacy@helix.dev", password: "Password123!" },
  });
  assert.equal(login.status, 200);
  assert.match(app.store.getUserById(user.id).passwordHash, /^scrypt\$/);
  const again = await call(app, "POST", "/api/v1/auth/login", {
    body: { email: "legacy@helix.dev", password: "Password123!" },
  });
  assert.equal(again.status, 200);
});

test("/auth/me, profile update, logout and change-password manage the session", async () => {
  const { app } = makeApp();
  const { token } = await signUp(app, "me@helix.dev");

  const me = await call(app, "GET", "/api/v1/auth/me", { token });
  assert.equal(me.status, 200);
  assert.equal(me.json.user.email, "me@helix.dev");
  assert.equal(me.json.user.passwordHash, undefined);

  const renamed = await call(app, "PATCH", "/api/v1/auth/me", { token, body: { name: "Renamed" } });
  assert.equal(renamed.json.user.name, "Renamed");
  assert.equal(
    (await call(app, "PATCH", "/api/v1/auth/me", { token, body: { name: "" } })).status,
    400,
  );

  const other = await call(app, "POST", "/api/v1/auth/login", {
    body: { email: "me@helix.dev", password: "Password123!" },
  });
  const wrong = await call(app, "POST", "/api/v1/auth/change-password", {
    token,
    body: { currentPassword: "nope", newPassword: "NewPassword456!" },
  });
  assert.equal(wrong.status, 401);
  const weak = await call(app, "POST", "/api/v1/auth/change-password", {
    token,
    body: { currentPassword: "Password123!", newPassword: "weak" },
  });
  assert.equal(weak.status, 400);
  const changed = await call(app, "POST", "/api/v1/auth/change-password", {
    token,
    body: { currentPassword: "Password123!", newPassword: "NewPassword456!" },
  });
  assert.equal(changed.status, 200);
  assert.equal(
    (await call(app, "GET", "/api/v1/auth/me", { token: other.json.token })).status,
    401,
    "other sessions revoked",
  );
  assert.equal(
    (await call(app, "GET", "/api/v1/auth/me", { token })).status,
    200,
    "current session kept",
  );

  assert.equal((await call(app, "POST", "/api/v1/auth/logout", { token })).status, 200);
  assert.equal((await call(app, "GET", "/api/v1/auth/me", { token })).status, 401);
});

test("password reset persists the new password and revokes existing sessions", async () => {
  const { app } = makeApp();
  const { token } = await signUp(app, "reset@helix.dev");
  const req = await call(app, "POST", "/api/v1/auth/password-reset/request", {
    body: { email: "reset@helix.dev" },
  });
  assert.ok(req.json.resetToken);
  const done = await call(app, "POST", "/api/v1/auth/password-reset/complete", {
    body: { token: req.json.resetToken, password: "Brandnew789!" },
  });
  assert.equal(done.status, 200);
  assert.equal((await call(app, "GET", "/api/v1/auth/me", { token })).status, 401);
  assert.equal(
    (
      await call(app, "POST", "/api/v1/auth/login", {
        body: { email: "reset@helix.dev", password: "Password123!" },
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await call(app, "POST", "/api/v1/auth/login", {
        body: { email: "reset@helix.dev", password: "Brandnew789!" },
      })
    ).status,
    200,
  );
});

test("OAuth without configured credentials is refused instead of creating demo accounts", async () => {
  const { app } = makeApp();
  const usersBefore = app.store.users.size;
  for (const provider of ["google", "github"]) {
    const res = await call(app, "POST", `/api/v1/auth/${provider}/callback`, {
      body: { code: "abc" },
    });
    assert.equal(res.status, 501);
    assert.equal(res.json.error.code, "OAUTH_NOT_CONFIGURED");
  }
  assert.equal(app.store.users.size, usersBefore);
});

test("demo login can be disabled and production requires a real JWT secret", async () => {
  const { app } = makeApp({ env: { HELIX_ENABLE_DEMO: "false" } });
  assert.equal((await call(app, "POST", "/api/v1/auth/demo")).status, 403);
  assert.throws(
    () => createApp({ storagePath: ":memory:", env: { NODE_ENV: "production" } }),
    /JWT_SECRET/,
  );
  assert.doesNotThrow(() =>
    createApp({
      storagePath: ":memory:",
      env: { NODE_ENV: "production", JWT_SECRET: "a".repeat(48) },
    }),
  );
});

test("malformed JSON, oversized bodies and unknown routes return structured errors", async () => {
  const { app } = makeApp({ env: { MAX_BODY_BYTES: "100" } });
  const bad = await call(app, "POST", "/api/v1/auth/login", { body: "{not json" });
  assert.equal(bad.status, 400);
  assert.equal(bad.json.error.code, "INVALID_JSON");
  assert.ok(bad.json.error.requestId);

  const big = await call(app, "POST", "/api/v1/auth/login", {
    body: { email: "x".repeat(200) },
    headers: { "content-length": "250" },
  });
  assert.equal(big.status, 413);

  const missing = await call(app, "GET", "/api/v1/nope");
  assert.equal(missing.status, 404);
  assert.equal(missing.headers.get("x-content-type-options"), "nosniff");
});

test("CORS only reflects allowed origins", async () => {
  const { app } = makeApp({ env: { CORS_ORIGINS: "https://app.helix.dev" } });
  const ok = await call(app, "GET", "/api/v1/health", {
    headers: { origin: "https://app.helix.dev" },
  });
  assert.equal(ok.headers.get("access-control-allow-origin"), "https://app.helix.dev");
  const blocked = await call(app, "GET", "/api/v1/health", {
    headers: { origin: "https://evil.example" },
  });
  assert.equal(blocked.headers.get("access-control-allow-origin"), null);
});

test("workflow routes enforce ownership (no cross-tenant approve/traces/retry/cancel/stream)", async () => {
  const { app, ai } = makeApp();
  const alice = await signUp(app, "alice@helix.dev");
  const mallory = await signUp(app, "mallory@helix.dev");
  const project = await createProject(app, alice.token);

  const started = await call(app, "POST", `/api/v1/projects/${project.id}/workflows`, {
    token: alice.token,
  });
  const workflowId = started.json.id;
  await waitFor(() => ai.orchestrator.getWorkflow(workflowId).status === "awaiting_approval");

  for (const [method, path, body] of [
    [
      "POST",
      `/api/v1/workflows/${workflowId}/approve`,
      { checkpointType: "architecture_approval", approved: true },
    ],
    ["GET", `/api/v1/workflows/${workflowId}/traces`],
    ["POST", `/api/v1/workflows/${workflowId}/retry`, {}],
    ["POST", `/api/v1/workflows/${workflowId}/cancel`, {}],
  ]) {
    const res = await call(app, method, path, { token: mallory.token, body });
    assert.equal(res.status, 404, `${method} ${path} must be hidden from non-owners`);
  }
  assert.equal(
    ai.orchestrator.getWorkflow(workflowId).status,
    "awaiting_approval",
    "state untouched by attacker",
  );

  const stream = await call(
    app,
    "GET",
    `/api/v1/projects/${project.id}/workflows/stream?token=${mallory.token}`,
  );
  assert.equal(stream.status, 403);
  assert.equal(
    (
      await call(app, "PATCH", `/api/v1/projects/${project.id}`, {
        token: mallory.token,
        body: { name: "pwned" },
      })
    ).status,
    403,
  );
  assert.equal(
    (await call(app, "GET", `/api/v1/workflows/${workflowId}/traces`, { token: alice.token }))
      .status,
    200,
  );
});
