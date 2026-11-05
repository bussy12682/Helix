import test from "node:test";
import assert from "node:assert/strict";

import { createAiSubsystem, AGENT_ROLES, AiProviderError } from "../ai/index.js";
import { ModelRouter } from "../ai/model-router.js";
import { makeApp, call, signUp, createProject } from "./helpers.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const messages = [{ role: "user", content: '{"taskId":"t1","context":{"project":{"name":"X"}}}' }];

function slowAgent(ai, role, ms = 40) {
  const agent = ai.workforce.getAgent(role);
  const original = agent.execute.bind(agent);
  agent.execute = async (args) => {
    await sleep(ms);
    return original(args);
  };
}

test("deleting a project mid-run does not resurrect its workflow or workspace", async () => {
  const ai = createAiSubsystem({ mockMode: true });
  const orch = ai.orchestrator;
  const saved = new Map();
  orch.attachStorage({ saveWorkflow: (wf) => saved.set(wf.id, structuredClone(wf)) }, []);
  const workspaceWrites = [];
  ai.contextManager.setPersistence((ws) => workspaceWrites.push(ws.projectId));
  slowAgent(ai, AGENT_ROLES.PRODUCT_MANAGER);

  const wf = await orch.createWorkflow("proj_deleted", { name: "Doomed" });
  const run = orch.runNextSteps(wf.id);
  await sleep(5);
  saved.delete(wf.id);
  orch.removeProject("proj_deleted");
  const writesAtDelete = workspaceWrites.length;
  await run;

  assert.equal(saved.has(wf.id), false);
  assert.ok(!orch.getWorkflow(wf.id));
  assert.equal(ai.contextManager.projectWorkspaces.has("proj_deleted"), false);
  assert.equal(workspaceWrites.length, writesAtDelete);
});

test("a new workspace is persisted immediately with the project brief", () => {
  const ai = createAiSubsystem({ mockMode: true });
  const writes = [];
  ai.contextManager.setPersistence((ws) => writes.push(ws));
  ai.contextManager.getOrCreateWorkspace("proj_brief", { name: "Inventory", description: "Stock" });
  assert.equal(writes.length, 1);
  assert.equal(writes[0].name, "Inventory");
  assert.equal(writes[0].description, "Stock");
});

test("retrying immediately after cancel waits for the aborted run and then resumes", async () => {
  const ai = createAiSubsystem({ mockMode: true });
  const orch = ai.orchestrator;
  slowAgent(ai, AGENT_ROLES.PRODUCT_MANAGER);
  const wf = await orch.createWorkflow("proj_retry_cancel", { name: "Retry" });
  orch.runNextSteps(wf.id).catch(() => {});
  await sleep(5);
  orch.cancelWorkflow(wf.id);
  const { run } = orch.retryWorkflow(wf.id);
  await run;
  assert.equal(wf.status, "awaiting_approval");
  assert.equal(wf.tasks[0].status, "completed");
});

test("fallback providers never reuse the primary provider's credential", async () => {
  const seen = [];
  const router = new ModelRouter({
    aiProvider: "google",
    aiApiKey: "g-key",
    googleAiApiKey: "g-key",
    openAiApiKey: "",
    aiFallbackProviders: "openai",
    aiMaxRetries: 0,
    aiRetryBaseDelayMs: 1,
    allowMockFallback: false,
    fetchImpl: async (url, init) => {
      seen.push({
        url: String(url),
        auth: init?.headers?.Authorization ?? init?.headers?.authorization,
      });
      return new Response("unavailable", { status: 503 });
    },
  });
  assert.deepEqual(router.getStatus().configuredProviders, ["google"]);
  await assert.rejects(
    router.complete({ agentRole: AGENT_ROLES.QA_ENGINEER, messages }),
    AiProviderError,
  );
  assert.ok(seen.length > 0);
  assert.ok(
    seen.every((s) => !s.url.includes("api.openai.com")),
    JSON.stringify(seen),
  );
});

test("local Ollama completions are forwarded to onToken", async () => {
  const router = new ModelRouter({
    aiProvider: "openai",
    openAiApiKey: "",
    allowMockFallback: false,
    fetchImpl: async (url) =>
      String(url).endsWith("/api/tags")
        ? new Response("{}", { status: 200 })
        : new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":1}' } }] }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
  });
  const tokens = [];
  const res = await router.complete({
    agentRole: AGENT_ROLES.QA_ENGINEER,
    messages,
    options: { onToken: (t) => tokens.push(t) },
  });
  assert.equal(res.provider, "ollama");
  assert.equal(tokens.join(""), '{"ok":1}');
});

test("an open SSE stream is closed once its session is revoked", async () => {
  const { app } = makeApp();
  const { token } = await signUp(app, "revoked@helix.dev");
  const project = await createProject(app, token, "Revoked");
  const res = await app.request(
    `http://localhost/api/v1/projects/${project.id}/workflows/stream?token=${token}`,
  );
  assert.equal(res.status, 200);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  while (!text.includes("office_snapshot")) text += decoder.decode((await reader.read()).value);

  const logout = await call(app, "POST", "/api/v1/auth/logout", { token });
  assert.equal(logout.status, 200);
  // Another valid user triggers activity on the bus; the revoked stream must not receive it.
  const other = await signUp(app, "other@helix.dev");
  const otherProject = await createProject(app, other.token, "Other");
  await call(app, "POST", `/api/v1/projects/${otherProject.id}/workflows`, { token: other.token });

  let after = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    after += decoder.decode(value);
  }
  assert.match(after, /session_revoked/);
  assert.doesNotMatch(after, /workflow_created/);
});

test("chunked request bodies without Content-Length are size limited", async () => {
  const { app } = makeApp({ env: { MAX_BODY_BYTES: "100" } });
  const payload = new TextEncoder().encode(
    JSON.stringify({ email: "x".repeat(500), password: "p" }),
  );
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(payload);
      controller.close();
    },
  });
  const res = await app.request("http://localhost/api/v1/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
    duplex: "half",
  });
  assert.equal(res.status, 413);
  assert.equal((await res.json()).error.code, "PAYLOAD_TOO_LARGE");
});

test("retry after cancelling at an approval gate restores the checkpoint instead of skipping it", async () => {
  const ai = createAiSubsystem({ mockMode: true });
  const orch = ai.orchestrator;
  const wf = await orch.createWorkflow("proj_gate_retry", { name: "Gate" });
  await orch.runNextSteps(wf.id);
  assert.equal(wf.status, "awaiting_approval");
  const gate = wf.currentCheckpoint.checkpointType;
  const progress = wf.progress;

  orch.cancelWorkflow(wf.id);
  const { run } = orch.retryWorkflow(wf.id);
  await run;
  assert.equal(wf.status, "awaiting_approval");
  assert.equal(wf.currentCheckpoint.checkpointType, gate);
  assert.equal(wf.progress, progress, "no dependent task ran before approval");
  const db = wf.tasks.find((t) => t.agent === AGENT_ROLES.DATABASE_ENGINEER);
  assert.equal(db.status, "queued");
});

test("clearWorkspace resets without tombstoning; reads never persist placeholder briefs", () => {
  const ai = createAiSubsystem({ mockMode: true });
  const cm = ai.contextManager;
  const writes = [];
  cm.setPersistence((ws) => writes.push(structuredClone(ws)));

  cm.getArtifacts("p_read");
  assert.equal(writes.length, 0, "a read must not persist an Untitled Project workspace");
  cm.getOrCreateWorkspace("p_read", { name: "Inventory", description: "Track stock" });
  assert.equal(cm.getOrCreateWorkspace("p_read").name, "Inventory");
  assert.equal(writes.at(-1).description, "Track stock");

  cm.clearWorkspace("p1");
  cm.getOrCreateWorkspace("p1", { name: "Again" });
  cm.saveArtifact("p1", {
    name: "PRD",
    type: "doc",
    path: "docs/prd.md",
    content: "x",
    createdBy: "pm",
  });
  assert.equal(cm.getArtifacts("p1").length, 1);
});
