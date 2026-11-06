/**
 * Autonomous engineering acceptance tests.
 *
 * These tests verify HELIX's autonomous loop — natural-language brief → nine-agent
 * generation through the DAG → real install/test/build jobs → deliberate failure →
 * provider repair → real verification — against a LOCAL OpenAI-compatible contract
 * server. The transport is the genuine provider path (authentication, retries, JSON
 * contract); the intelligence behind it is scripted. This is local-endpoint
 * verification: it proves the platform loop, not live-vendor model quality.
 */

import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { createApp } from "../app.js";
import { ModelRouter } from "../ai/model-router.js";
import { AGENT_ROLES } from "../ai/contracts.js";
import { call, signUp, createProject, waitFor } from "./helpers.js";

const ROLE_MARKERS = Object.entries({
  [AGENT_ROLES.PRODUCT_MANAGER]: "PRODUCT MANAGER",
  [AGENT_ROLES.SYSTEM_ARCHITECT]: "SYSTEM ARCHITECT",
  [AGENT_ROLES.DATABASE_ENGINEER]: "DATABASE ENGINEER",
  [AGENT_ROLES.BACKEND_ENGINEER]: "BACKEND ENGINEER",
  [AGENT_ROLES.FRONTEND_ENGINEER]: "FRONTEND ENGINEER",
  [AGENT_ROLES.SECURITY_ENGINEER]: "SECURITY ENGINEER",
  [AGENT_ROLES.QA_ENGINEER]: "QA ENGINEER",
  [AGENT_ROLES.DEVOPS_ENGINEER]: "DEVOPS ENGINEER",
  [AGENT_ROLES.DOCUMENTATION_ENGINEER]: "DOCUMENTATION ENGINEER",
});

const SERVICE_PATH = "src/api/service.js";
const CORRECT_SERVICE =
  "function listResources() {\n  return [{ id: 'welcome', name: 'HELIX offline starter', status: 'ready' }];\n}\nmodule.exports = { listResources }";

function serviceFixture(status) {
  return `function listResources() {\n  return [{ id: 'welcome', name: 'HELIX offline starter', status: '${status}' }];\n}\nmodule.exports = { listResources }`;
}

function repairBody(content, summary) {
  return {
    agent: AGENT_ROLES.BACKEND_ENGINEER,
    status: "completed",
    task_id: "TASK-REPAIR",
    summary,
    artifacts: [{ name: "service.js", type: "code", path: SERVICE_PATH, content }],
    decisions: [
      {
        key: "repair_strategy",
        decision: "minimal-file-replacement",
        rationale: "Fix derived from the captured failing test output",
      },
    ],
    dependencies: [],
    risks: [],
    next_actions: [],
  };
}

/**
 * A local OpenAI-compatible provider. Generation requests are answered with the
 * deterministic coherent starter app (the same body the offline mock would emit,
 * served through the real HTTP contract). Repair requests are answered from a
 * caller-supplied script so tests control provider quality precisely.
 */
async function scriptedProvider({ onRepair, corruptGeneration = null, delayMs = 0, status = 200 } = {}) {
  const requests = [];
  const mock = new ModelRouter({ mockMode: true });
  const server = http.createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    let body = null;
    try {
      body = JSON.parse(raw);
    } catch {
      body = {};
    }
    const entry = { url: req.url, authorization: req.headers.authorization ?? null, body };
    requests.push(entry);
    if (status !== 200) {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "scripted provider failure" }));
      return;
    }
    if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));

    const system = body?.messages?.[0]?.content ?? "";
    const user = [...(body?.messages ?? [])].reverse().find((m) => m.role === "user")?.content ?? "{}";
    let parsed = {};
    try {
      parsed = JSON.parse(user);
    } catch {
      parsed = {};
    }

    let payload;
    if (parsed.context?.failure && typeof parsed.context.failure === "object") {
      entry.repair = true;
      entry.failureSeen = parsed.context.failure;
      payload = onRepair
        ? onRepair(parsed, entry)
        : repairBody(CORRECT_SERVICE, "Replaced the fixture with the tested value.");
    } else {
      const marker = ROLE_MARKERS.find(([, token]) => system.includes(`SPECIALIZED ${token} GUIDELINES`));
      if (!marker) throw new Error(`Scripted provider could not identify the agent role: ${system.slice(0, 120)}`);
      const generated = JSON.parse(mock.generateMockResponse(marker[0], body.messages).content);
      if (corruptGeneration && marker[0] === AGENT_ROLES.BACKEND_ENGINEER) corruptGeneration(generated);
      payload = generated;
    }
    entry.agent = payload.agent ?? "backend_engineer";
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        choices: [{ message: { role: "assistant", content: JSON.stringify(payload) } }],
        usage: { prompt_tokens: 100, completion_tokens: 200, total_tokens: 300 },
      }),
    );
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();
  return {
    requests,
    url: `http://127.0.0.1:${port}/v1`,
    close: () =>
      new Promise((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections?.();
      }),
  };
}

async function setupWithProvider(t, provider, env = {}) {
  const root = await mkdtemp(path.join(tmpdir(), "helix-autonomous-test-"));
  const app = createApp({
    storagePath: ":memory:",
    env: {
      HELIX_WORKSPACE_ROOT: root,
      AI_PROVIDER: "openai",
      AI_API_KEY: "local-contract-key",
      OPENAI_BASE_URL: provider.url,
      HELIX_MOCK_AI: "false",
      HELIX_ALLOW_MOCK_FALLBACK: "false",
      ...env,
    },
  });
  t.after(async () => {
    app.close();
    await new Promise((resolve) => setTimeout(resolve, 50));
    await rm(root, { recursive: true, force: true });
  });
  const { token } = await signUp(app, `autonomous-${crypto.randomUUID()}@example.com`);
  const brief = await call(app, "POST", "/api/v1/projects", {
    token,
    body: {
      name: "Task Logger Service",
      description:
        "A small Node.js service that records tasks, exposes a JSON resource list, and ships executable tests, a build step, and a previewable UI.",
      keyFeatures: ["List resources as JSON", "Executable regression tests", "Static build"],
      techStack: ["Node.js"],
    },
  });
  assert.equal(brief.status, 201, JSON.stringify(brief.json));
  return { app, token, project: brief.json };
}

async function waitForRun(app, token, projectId, runId, { timeoutMs = 120000 } = {}) {
  return waitFor(
    async () => {
      const response = await call(app, "GET", `/api/v1/projects/${projectId}/pipeline/runs/${runId}`, { token });
      assert.equal(response.status, 200, JSON.stringify(response.json));
      return response.json.run.status === "running" ? null : response.json.run;
    },
    { timeoutMs, intervalMs: 25 },
  );
}

test("autonomous pipeline generates, executes, and self-repairs an application from a natural-language brief", async (t) => {
  // The scripted provider generates an app whose backend fixture disagrees with the
  // QA-authored tests (status 'pending' vs the tested 'ready'), so the autonomous
  // pipeline must detect the real test failure and repair it through the provider.
  const provider = await scriptedProvider({
    corruptGeneration: (generated) => {
      const service = generated.artifacts.find((artifact) => artifact.path === SERVICE_PATH);
      service.content = serviceFixture("pending");
    },
    onRepair: () => repairBody(CORRECT_SERVICE, "Aligned the service fixture with the QA-tested value."),
  });
  t.after(provider.close);
  const { app, token, project } = await setupWithProvider(t, provider);

  const started = await call(app, "POST", `/api/v1/projects/${project.id}/pipeline/run`, {
    token,
    body: { regenerate: true },
  });
  assert.equal(started.status, 202, JSON.stringify(started.json));
  const runId = started.json.run.id;

  const run = await waitForRun(app, token, project.id, runId);
  assert.ok(run, "pipeline run did not finish in time");
  assert.equal(run.status, "completed", JSON.stringify(run));
  const stepBy = (kind) => run.steps.filter((step) => step.kind === kind);

  // Generation: nine agents through the DAG, both human gates auto-approved and recorded.
  const generate = stepBy("generate");
  assert.equal(generate.length, 1);
  assert.equal(generate[0].status, "completed");
  assert.equal(generate[0].detail.tasks, 9);
  assert.equal(generate[0].detail.autoApprovals, 2);
  assert.equal(stepBy("materialize")[0].status, "completed");

  // Real jobs: dependency install, test failure, and autonomous provider repair.
  const install = stepBy("install");
  assert.equal(install[0].status, "completed");
  assert.ok(install[0].jobId, "install must reference a real job");
  const testSteps = stepBy("test");
  assert.equal(testSteps.length, 1);
  assert.equal(testSteps[0].status, "failed", "the generated app must genuinely fail its tests first");
  assert.ok(testSteps[0].jobId);
  assert.equal(testSteps[0].verified, true, "the test step must be repaired and re-verified");
  assert.equal(testSteps[0].repairRounds, 1);
  const repair = stepBy("repair");
  assert.equal(repair.length, 1);
  assert.equal(repair[0].status, "completed");
  assert.equal(repair[0].verified, true);
  assert.equal(repair[0].detail.provider, "openai");
  assert.equal(repair[0].detail.simulated, false);
  assert.ok(repair[0].detail.rounds[0].exitCode === 0);
  const build = stepBy("build");
  assert.equal(build[0].status, "completed");

  // The verification claim must be backed by a real completed sandbox job.
  const verifyJob = app.execution.getJob(project.id, repair[0].detail.rounds.at(-1).jobId);
  assert.ok(verifyJob?.result, "the repair verification must reference a real execution job");
  assert.equal(verifyJob.status, "completed");
  assert.equal(verifyJob.result.exitCode, 0);

  // Every agent request went through the real OpenAI-compatible transport.
  const agentCalls = provider.requests.filter((request) => !request.repair);
  assert.equal(agentCalls.length, 9);
  assert.equal(provider.requests.filter((request) => request.repair).length, 1);
  assert.ok(provider.requests.every((request) => request.authorization === "Bearer local-contract-key"));
  assert.ok(provider.requests[0].body.response_format?.type === "json_object");
  assert.ok(provider.requests[0].url.includes("/chat/completions"));

  // The workspace now holds the repaired, verified application files.
  const files = await call(app, "GET", `/api/v1/projects/${project.id}/files`, { token });
  const paths = files.json.files.map((file) => file.path);
  for (const expected of ["package.json", "server.js", SERVICE_PATH, "public/index.html", "tests/routes.test.js"]) {
    assert.ok(paths.includes(expected), `missing generated file ${expected}`);
  }
  const serviceFile = await call(
    app,
    "GET",
    `/api/v1/projects/${project.id}/files?path=${encodeURIComponent(SERVICE_PATH)}`,
    { token },
  );
  assert.equal(serviceFile.status, 200);
  assert.equal(serviceFile.json.file.content, CORRECT_SERVICE);

  // The persisted run summary keeps the honest record.
  const history = await call(app, "GET", `/api/v1/projects/${project.id}/context`, { token });
  assert.equal(history.status, 200);
  assert.equal(history.json.pipelineRuns.length, 1);
  assert.equal(history.json.pipelineRuns[0].status, "completed");
});

test("deliberate bug is diagnosed and repaired by the configured provider across verification rounds", async (t) => {
  // First repair proposal is wrong on purpose ('almost'), the second uses the new
  // failure output to land the correct fix — proving genuine iterative repair.
  let repairCalls = 0;
  const provider = await scriptedProvider({
    onRepair: (parsed) => {
      repairCalls += 1;
      return repairCalls === 1
        ? repairBody(serviceFixture("almost"), "Changed the fixture status to address the failing assertion.")
        : repairBody(CORRECT_SERVICE, "Matched the exact object the QA suite asserts.");
    },
  });
  t.after(provider.close);
  const { app, token, project } = await setupWithProvider(t, provider);

  // Phase 1: a green application produced by the autonomous pipeline.
  const started = await call(app, "POST", `/api/v1/projects/${project.id}/pipeline/run`, { token, body: {} });
  assert.equal(started.status, 202, JSON.stringify(started.json));
  const green = await waitForRun(app, token, project.id, started.json.run.id);
  assert.ok(green, "initial pipeline run did not finish in time");
  assert.equal(green.status, "completed", JSON.stringify(green));
  assert.equal(green.steps.find((step) => step.kind === "test").status, "completed");

  // Phase 2: introduce a deliberate bug through the files API and capture the real failure.
  const bugWrite = await call(app, "PUT", `/api/v1/projects/${project.id}/files`, {
    token,
    body: { path: SERVICE_PATH, content: serviceFixture("broken") },
  });
  assert.equal(bugWrite.status, 200, JSON.stringify(bugWrite.json));
  const bugJobResponse = await call(app, "POST", `/api/v1/projects/${project.id}/execute`, {
    token,
    body: { command: ["npm", "test"] },
  });
  assert.equal(bugJobResponse.status, 202, JSON.stringify(bugJobResponse.json));
  const bugJob = await waitFor(
    () => app.execution.getJob(project.id, bugJobResponse.json.job.id).completedAt
      ? app.execution.getJob(project.id, bugJobResponse.json.job.id)
      : null,
    { timeoutMs: 60000 },
  );
  assert.equal(bugJob.status, "failed");
  assert.notEqual(bugJob.result.exitCode, 0);

  // Phase 3: the configured provider diagnoses the real captured output.
  const proposalResponse = await call(app, "POST", `/api/v1/projects/${project.id}/repair`, {
    token,
    body: { jobId: bugJob.id },
  });
  assert.equal(proposalResponse.status, 200, JSON.stringify(proposalResponse.json));
  const proposal = proposalResponse.json;
  assert.equal(proposal.provider, "openai");
  assert.equal(proposal.simulated, false);
  assert.equal(proposal.verified, false);
  assert.equal(proposal.basedOnJobId, bugJob.id);
  assert.deepEqual(proposal.files.map((file) => file.path), [SERVICE_PATH]);
  assert.ok(proposal.files[0].content.includes("almost"));
  // The provider really received the captured runtime failure.
  const firstRepairRequest = provider.requests.find((request) => request.repair);
  assert.equal(firstRepairRequest.failureSeen.exitCode, bugJob.result.exitCode);
  assert.ok(firstRepairRequest.failureSeen.stdout.includes("AssertionError"));

  // Phase 4: apply and verify — round 1 stays broken, round 2 fixes it for real.
  const verificationResponse = await call(app, "POST", `/api/v1/projects/${project.id}/repair/verify`, {
    token,
    body: { files: proposal.files, command: ["npm", "test"], maxRounds: 2 },
  });
  assert.equal(verificationResponse.status, 200, JSON.stringify(verificationResponse.json));
  const verification = verificationResponse.json;
  assert.equal(verification.verified, true);
  assert.equal(verification.finalStatus, "completed");
  assert.equal(verification.rounds.length, 2);
  assert.equal(verification.rounds[0].status, "failed");
  assert.equal(verification.rounds[0].exitCode, 1);
  assert.equal(verification.rounds[1].status, "completed");
  assert.equal(verification.rounds[1].exitCode, 0);
  for (const round of verification.rounds) {
    const job = app.execution.getJob(project.id, round.jobId);
    assert.ok(job?.result, `round ${round.round} must map to a real job`);
    assert.equal(job.kind, "verify");
  }

  // The second provider call saw the round-1 failure — genuine feedback-driven iteration.
  assert.equal(repairCalls, 2);
  const secondRepairRequest = provider.requests.filter((request) => request.repair)[1];
  assert.ok(
    JSON.stringify(secondRepairRequest.body).includes("almost"),
    "the round-2 prompt must contain the round-1 verification failure",
  );

  // Phase 5: the workspace and project memory record the verified repair.
  const serviceFile = await call(
    app,
    "GET",
    `/api/v1/projects/${project.id}/files?path=${encodeURIComponent(SERVICE_PATH)}`,
    { token },
  );
  assert.equal(serviceFile.json.file.content, CORRECT_SERVICE);
  const context = await call(app, "GET", `/api/v1/projects/${project.id}/context`, { token });
  assert.equal(context.json.repairHistory.length, 1);
  assert.equal(context.json.repairHistory[0].verified, true);
  assert.equal(context.json.repairHistory[0].rounds, 2);
  assert.equal(context.json.repairHistory[0].provider, "openai");
  assert.ok(context.json.recentExecutions.some((job) => job.kind === "verify" && job.status === "completed"));
});

test("only one autonomous run may be active per project", async (t) => {
  const provider = await scriptedProvider({ delayMs: 250 });
  t.after(provider.close);
  const { app, token, project } = await setupWithProvider(t, provider);

  const first = await call(app, "POST", `/api/v1/projects/${project.id}/pipeline/run`, { token, body: {} });
  assert.equal(first.status, 202, JSON.stringify(first.json));
  const second = await call(app, "POST", `/api/v1/projects/${project.id}/pipeline/run`, { token, body: {} });
  assert.equal(second.status, 409);
  assert.equal(second.json.error.code, "PIPELINE_ALREADY_RUNNING");

  // Let the slow-provider run finish so cleanup happens against a settled state.
  const run = await waitForRun(app, token, project.id, first.json.run.id, { timeoutMs: 180000 });
  assert.ok(run, "slow pipeline run did not finish in time");
  assert.equal(run.status, "completed", JSON.stringify(run));
  const third = await call(app, "POST", `/api/v1/projects/${project.id}/pipeline/run`, { token, body: { regenerate: false } });
  assert.equal(third.status, 202, JSON.stringify(third.json));
  const reused = await waitForRun(app, token, project.id, third.json.run.id);
  assert.ok(reused, "reuse run did not finish in time");
  assert.equal(reused.status, "completed", JSON.stringify(reused));
  assert.equal(reused.steps.filter((step) => step.kind === "generate").length, 0);
});

test("provider failures fail honestly — no success is ever claimed", async (t) => {
  const provider = await scriptedProvider({ status: 503 });
  t.after(provider.close);
  const { app, token, project } = await setupWithProvider(t, provider, { AI_MAX_RETRIES: "0" });

  const started = await call(app, "POST", `/api/v1/projects/${project.id}/pipeline/run`, { token, body: {} });
  assert.equal(started.status, 202);
  const run = await waitForRun(app, token, project.id, started.json.run.id);
  assert.ok(run, "failing pipeline run did not finish in time");
  assert.equal(run.status, "failed");
  assert.ok(/provider|AI_/i.test(run.error), `honest provider error expected, got: ${run.error}`);
  assert.equal(run.steps.filter((step) => step.status === "completed").length, 0);
  // No application files were fabricated for the failed generation.
  assert.equal(app.workspace.list(project.id).length, 0);

  // The repair path surfaces the provider failure instead of a silent mock.
  await call(app, "PUT", `/api/v1/projects/${project.id}/files`, {
    token,
    body: { path: "package.json", content: JSON.stringify({ name: "x", scripts: { test: "node --test" } }) },
  });
  await call(app, "PUT", `/api/v1/projects/${project.id}/files`, {
    token,
    body: { path: "failing.test.js", content: "const test = require('node:test'); const assert = require('node:assert'); test('fails', () => assert.equal(1, 2));" },
  });
  const failing = await call(app, "POST", `/api/v1/projects/${project.id}/execute`, {
    token,
    body: { command: ["npm", "test"] },
  });
  assert.equal(failing.status, 202);
  const job = await waitFor(
    () => app.execution.getJob(project.id, failing.json.job.id).completedAt
      ? app.execution.getJob(project.id, failing.json.job.id)
      : null,
    { timeoutMs: 60000 },
  );
  const repair = await call(app, "POST", `/api/v1/projects/${project.id}/repair`, {
    token,
    body: { jobId: job.id },
  });
  assert.equal(repair.status, 502);
  assert.equal(repair.json.error.code, "AI_PROVIDER_FAILED");
  assert.ok(provider.requests.length >= 2);
});

test("project context memory exposes files, dependencies, execution history, and repairs", async (t) => {
  const provider = await scriptedProvider({});
  t.after(provider.close);
  const { app, token, project } = await setupWithProvider(t, provider);

  await call(app, "PUT", `/api/v1/projects/${project.id}/files`, {
    token,
    body: {
      path: "package.json",
      content: JSON.stringify({ name: "memory-fixture", scripts: { test: "node --test", build: "node build.js" }, dependencies: { express: "^4.0.0" } }),
    },
  });
  await call(app, "PUT", `/api/v1/projects/${project.id}/files`, {
    token,
    body: { path: "index.js", content: "console.log('ok');\n" },
  });
  const executed = await call(app, "POST", `/api/v1/projects/${project.id}/execute`, {
    token,
    body: { command: ["node", "index.js"], wait: true },
  });
  assert.equal(executed.status, 200);

  const context = await call(app, "GET", `/api/v1/projects/${project.id}/context`, { token });
  assert.equal(context.status, 200);
  const body = context.json;
  assert.deepEqual(body.files.map((file) => file.path).sort(), ["index.js", "package.json"]);
  assert.equal(body.fileCount, 2);
  assert.equal(body.packageJson.valid, true);
  assert.equal(body.packageJson.name, "memory-fixture");
  assert.deepEqual(body.packageJson.dependencies, ["express"]);
  assert.deepEqual(Object.keys(body.packageJson.scripts), ["test", "build"]);
  assert.ok(body.recentExecutions.length >= 1);
  assert.equal(body.recentExecutions[0].status, "completed");
  assert.equal(body.recentExecutions[0].exitCode, 0);
  assert.match(body.promptDigest, /memory-fixture/);
  assert.match(body.promptDigest, /index\.js/);
  assert.match(body.promptDigest, /express/);

  // Context is isolated per tenant.
  const { token: other } = await signUp(app, `intruder-${crypto.randomUUID()}@example.com`);
  const denied = await call(app, "GET", `/api/v1/projects/${project.id}/context`, { token: other });
  assert.equal(denied.status, 403);
});
