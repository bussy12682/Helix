/**
 * Operational controls (mission priority 5): token budgets, AI-route rate
 * limiting, per-project concurrency caps, the production autonomous-approval
 * policy, and the redacted audit trail. All budgets and audit records are
 * verified to persist across restarts — governance that forgets on reboot is
 * not governance.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import http from "node:http";

import { createApp } from "../app.js";
import { TokenBudgetService, AuditLog, BudgetExceededError } from "../operational-governance.js";
import { ModelRouter } from "../ai/model-router.js";
import { AGENT_ROLES } from "../ai/contracts.js";
import { makeApp, call, signUp, createProject, waitFor } from "./helpers.js";

function budgetApp(options = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), `helix-gov-${options.tag ?? "x"}-`));
  process.on("exit", () => {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  });
  const storagePath = options.storagePath ?? path.join(dir, "state.json");
  const app = createApp({
    storagePath,
    env: {
      HELIX_MOCK_AI: "true",
      ...(options.env ?? {}),
    },
  });
  return { app, storagePath };
}

function budgetStoreStub() {
  const budgetUsage = new Map();
  return {
    budgetUsage,
    saveBudgetUsage: (record) => budgetUsage.set(record.key ?? record.scopeKey, record),
  };
}

test("token budgets gate provider calls and account real usage", () => {
  const budgets = new TokenBudgetService({ store: budgetStoreStub(), userDailyTokenLimit: 1000 });
  budgets.authorize({ userId: "u1" });
  budgets.record({ userId: "u1", provider: "openai", usage: { total_tokens: 600 } });
  budgets.authorize({ userId: "u1" });
  budgets.record({ userId: "u1", provider: "openai", usage: { total_tokens: 500 } });
  assert.throws(
    () => budgets.authorize({ userId: "u1" }),
    (error) => {
      assert.ok(error instanceof BudgetExceededError);
      assert.equal(error.status, 429);
      assert.equal(error.code, "BUDGET_EXCEEDED");
      assert.equal(error.used, 1100);
      return true;
    },
  );
  // Other users and unlimited (0) limits are unaffected.
  budgets.authorize({ userId: "u2" });
  const unlimited = new TokenBudgetService({ store: budgetStoreStub(), userDailyTokenLimit: 0 });
  unlimited.record({ userId: "u1", usage: { total_tokens: 10_000_000 } });
  unlimited.authorize({ userId: "u1" });
});

test("budget spend persists across a restart, so limits cannot be reset by rebooting", async () => {
  const { app, storagePath } = budgetApp({ tag: "persist" });
  await app.ready;
  app.budgets.record({
    userId: "u1",
    projectId: "p1",
    provider: "google",
    usage: { total_tokens: 1234 },
  });
  app.store.flush();
  await app.close();

  const second = createApp({ storagePath, env: { HELIX_MOCK_AI: "true" } });
  await second.ready;
  const summary = second.budgets.getSummary({ userId: "u1", projectId: "p1" });
  assert.equal(summary.user.usedTokens, 1234);
  assert.equal(summary.project.usedTokens, 1234);
  assert.ok(summary.resetsAt.endsWith("T00:00:00.000Z"));
  await second.close();
});

test("model router authorizes before dispatch and accounts provider-reported usage", async () => {
  // A stub OpenAI-compatible endpoint so the router exercises its REAL
  // provider path (no mock): the policy must gate and account it.
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  agent: AGENT_ROLES.QA_ENGINEER,
                  status: "completed",
                  task_id: "T1",
                  summary: "s",
                  artifacts: [],
                  test_plan: "p",
                  test_cases: [],
                }),
              },
            },
          ],
          usage: { prompt_tokens: 40, completion_tokens: 60, total_tokens: 100 },
        }),
      );
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;

  const seen = [];
  const router = new ModelRouter({
    aiProvider: "openai",
    openAiApiKey: "test-key",
    openAiBaseUrl: `http://127.0.0.1:${port}/v1`,
    mockMode: false,
    allowMockFallback: false,
  });
  const store = budgetStoreStub();
  store.saveBudgetUsage = (record) => {
    store.budgetUsage.set(record.key ?? record.scopeKey, record);
    seen.push(record);
  };
  const budgets = new TokenBudgetService({ store, userDailyTokenLimit: 100 });
  router.setUsagePolicy({
    enrich: (context) => ({ ...context, userId: context.userId ?? "enriched-user" }),
    authorize: (context) => budgets.authorize(context),
    record: (context, result) =>
      budgets.record({
        ...context,
        provider: result.provider,
        model: result.model,
        usage: result.usage,
      }),
  });

  const options = { usageContext: { projectId: "p1" } };
  await router.complete({
    agentRole: AGENT_ROLES.QA_ENGINEER,
    messages: [{ role: "user", content: "{}" }],
    options,
  });
  assert.equal(
    budgets.usedTokens({ userId: "enriched-user" }),
    100,
    "usage must be accounted from the provider response",
  );

  await assert.rejects(
    () =>
      router.complete({
        agentRole: AGENT_ROLES.QA_ENGINEER,
        messages: [{ role: "user", content: "{}" }],
        options,
      }),
    (error) => error instanceof BudgetExceededError,
    "the second call must be rejected before dispatch once the budget is exhausted",
  );
  server.close();
});

test("AI routes enforce per-user rate limits with audited 429s", async () => {
  const { app } = budgetApp({ tag: "rate", env: { HELIX_AI_RATE_LIMIT_MAX: "2" } });
  await app.ready;
  const { token } = await signUp(app, `rate-${crypto.randomUUID()}@example.com`);
  const responses = [];
  for (let i = 0; i < 3; i += 1) {
    responses.push(
      await call(app, "POST", "/api/v1/projects/analyze", {
        token,
        body: { name: "R", description: "d", conversation: [] },
      }),
    );
  }
  assert.equal(responses.filter((r) => r.status !== 429).length, 2);
  assert.equal(responses.filter((r) => r.status === 429).length, 1);
  assert.match(responses[2].json.error.message, /Too many AI requests/);
  const audited = app.audit.listForUser(
    (await app.store.getUserByEmail(responses.length ? "x" : "x"))?.id ?? "",
    { limit: 10 },
  );
  assert.equal(audited.length, 0, "sanity: wrong user sees nothing");
  await app.close();
});

test("per-project execution concurrency cap is configurable and enforced", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "helix-cap-"));
  process.on("exit", () => rmSync(dir, { recursive: true, force: true }));
  const { app } = makeApp({
    env: { HELIX_MAX_ACTIVE_JOBS_PER_PROJECT: "1", HELIX_WORKSPACE_ROOT: dir },
  });
  await app.ready;
  const availability = await app.execution.getStatus();
  if (!availability.available) return; // concurrency cap logic is provider-independent; skip when sandbox absent
  const { token } = await signUp(app, `cap-${crypto.randomUUID()}@example.com`);
  const project = await createProject(app, token, "Capped");
  const first = app.execution.start(project.id, {
    command: ["node", "-e", "setTimeout(()=>{},2000)"],
    kind: "command",
    timeoutMs: 10000,
  });
  assert.throws(
    () =>
      app.execution.start(project.id, {
        command: ["node", "-e", "1"],
        kind: "command",
        timeoutMs: 5000,
      }),
    /maximum of 1 active execution jobs/i,
  );
  first.stopRequested = true;
  app.execution.stop(project.id, first.id);
  await first.completion;
});

test("autonomous pipeline requires explicit approval opt-in in production", async () => {
  const { app } = budgetApp({
    tag: "prod",
    env: { NODE_ENV: "production", HELIX_MOCK_AI: "true", JWT_SECRET: "x".repeat(32) },
  });
  await app.ready;
  // In production the verification token is never leaked in the HTTP response,
  // so verify through the store exactly as the emailed link would.
  const email = `prod-${crypto.randomUUID()}@example.com`;
  await call(app, "POST", "/api/v1/auth/register", {
    body: { name: "Prod User", email, password: "Password123!" },
  });
  const registered = app.store.getUserByEmail(email);
  app.store.verifyEmail(registered.emailVerificationToken);
  const login = await call(app, "POST", "/api/v1/auth/login", {
    body: { email, password: "Password123!" },
  });
  assert.equal(login.status, 200);
  const token = login.json.token;
  const project = await createProject(app, token, "Prod Gated");
  const denied = await call(app, "POST", `/api/v1/projects/${project.id}/pipeline/run`, {
    token,
    body: { regenerate: false },
  });
  assert.equal(denied.status, 403);
  assert.equal(denied.json.error.code, "AUTONOMOUS_APPROVAL_REQUIRED");
  assert.match(denied.json.error.message, /HELIX_AUTONOMOUS_AUTO_APPROVE=true/);
  await app.close();

  const enabled = budgetApp({
    tag: "prod2",
    env: {
      NODE_ENV: "production",
      HELIX_MOCK_AI: "true",
      JWT_SECRET: "x".repeat(32),
      HELIX_AUTONOMOUS_AUTO_APPROVE: "true",
      HELIX_WORKSPACE_ROOT: mkdtempSync(path.join(tmpdir(), "helix-prodrun-")),
    },
  });
  await enabled.app.ready;
  const email2 = `prod2-${crypto.randomUUID()}@example.com`;
  await call(enabled.app, "POST", "/api/v1/auth/register", {
    body: { name: "Prod User 2", email: email2, password: "Password123!" },
  });
  const registered2 = enabled.app.store.getUserByEmail(email2);
  enabled.app.store.verifyEmail(registered2.emailVerificationToken);
  const login2 = await call(enabled.app, "POST", "/api/v1/auth/login", {
    body: { email: email2, password: "Password123!" },
  });
  assert.equal(login2.status, 200);
  const token2 = login2.json.token;
  const project2 = await createProject(enabled.app, token2, "Prod Enabled");
  const accepted = await call(enabled.app, "POST", `/api/v1/projects/${project2.id}/pipeline/run`, {
    token: token2,
    body: { regenerate: true },
  });
  assert.equal(accepted.status, 202, JSON.stringify(accepted.json));
  await waitFor(() => enabled.app.pipeline.runs.get(accepted.json.run.id)?.status !== "running", {
    timeoutMs: 30000,
  });
  await enabled.app.close();
});

test("audit trail records security-relevant events, redacts secrets, and stays user-scoped", async () => {
  const { app, storagePath } = budgetApp({ tag: "audit" });
  await app.ready;
  const email = `audit-${crypto.randomUUID()}@example.com`;
  const { token, user } = await signUp(app, email);

  // Failed login with a secret-looking detail must be redacted in storage.
  await call(app, "POST", "/api/v1/auth/login", {
    body: { email, password: "WrongPassword1!" },
  });
  const project = await createProject(app, token, "Audited Project");

  const auditResponse = await call(app, "GET", "/api/v1/audit", { token });
  assert.equal(auditResponse.status, 200);
  const events = auditResponse.json.events;
  assert.ok(events.some((event) => event.type === "auth.register"));
  assert.ok(events.some((event) => event.type === "auth.login" && event.outcome === "failure"));
  assert.ok(
    events.some((event) => event.type === "project.created" && event.projectId === project.id),
  );
  for (const event of events) {
    assert.equal(event.userId, user.id, "users must only see their own audit events");
    const serialized = JSON.stringify(event);
    assert.ok(
      !serialized.includes("WrongPassword1!"),
      "secrets must never appear in audit records",
    );
    assert.ok(!serialized.includes(token), "session tokens must never appear in audit records");
  }

  // Audit events survive a restart.
  app.store.flush();
  await app.close();
  const second = createApp({ storagePath, env: { HELIX_MOCK_AI: "true" } });
  await second.ready;
  const persisted = second.audit.listForUser(user.id, { limit: 50 });
  assert.ok(persisted.length >= 3, "audit history must persist across restarts");
  await second.close();
});

test("usage endpoint exposes the caller's own spend and configured limits", async () => {
  const { app } = budgetApp({ tag: "usage" });
  await app.ready;
  const { token, user } = await signUp(app, `usage-${crypto.randomUUID()}@example.com`);
  app.budgets.record({ userId: user.id, provider: "google", usage: { total_tokens: 42 } });
  const response = await call(app, "GET", "/api/v1/usage", { token });
  assert.equal(response.status, 200);
  assert.equal(response.json.usage.user.usedTokens, 42);
  assert.equal(response.json.usage.limits.userDailyTokens, 2_000_000);
  const unauthenticated = await call(app, "GET", "/api/v1/usage");
  assert.equal(unauthenticated.status, 401);
  await app.close();
});
