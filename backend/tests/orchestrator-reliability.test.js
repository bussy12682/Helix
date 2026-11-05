import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createApp } from "../app.js";
import { createAiSubsystem, AGENT_ROLES, WorkflowStateError } from "../ai/index.js";
import { makeApp, call, signUp, createProject, waitFor } from "./helpers.js";

function makeOrchestrator() {
  const ai = createAiSubsystem({ mockMode: true });
  return { ai, orch: ai.orchestrator };
}

test("an agent failure marks the workflow failed (not stuck running) and retry resumes it", async () => {
  const { ai, orch } = makeOrchestrator();
  const agent = ai.workforce.getAgent(AGENT_ROLES.SYSTEM_ARCHITECT);
  const original = agent.execute.bind(agent);
  let calls = 0;
  agent.execute = async (args) => {
    calls += 1;
    if (calls === 1) throw new Error("provider exploded");
    return original(args);
  };

  const wf = await orch.createWorkflow("proj_fail", { name: "Failing" });
  await orch.runNextSteps(wf.id);
  assert.equal(wf.status, "failed");
  assert.match(wf.error, /provider exploded/);
  const archTask = wf.tasks.find((t) => t.agent === AGENT_ROLES.SYSTEM_ARCHITECT);
  assert.equal(archTask.status, "failed");
  assert.equal(wf.tasks[0].status, "completed", "completed work is preserved");

  const { run } = orch.retryWorkflow(wf.id);
  await run;
  assert.equal(wf.status, "awaiting_approval");
  assert.equal(archTask.status, "completed");
  assert.equal(archTask.attempts, 2);
  assert.throws(() => orch.retryWorkflow(wf.id), WorkflowStateError);
});

test("concurrent runNextSteps calls share one execution (no double-run of agents)", async () => {
  const { ai, orch } = makeOrchestrator();
  const agent = ai.workforce.getAgent(AGENT_ROLES.PRODUCT_MANAGER);
  const original = agent.execute.bind(agent);
  let runs = 0;
  agent.execute = async (args) => {
    runs += 1;
    return original(args);
  };
  const wf = await orch.createWorkflow("proj_lock", { name: "Lock" });
  const [a, b] = [orch.runNextSteps(wf.id), orch.runNextSteps(wf.id)];
  assert.equal(a, b);
  await a;
  assert.equal(runs, 1);
});

test("cancel aborts the workflow and duplicate active workflows are rejected", async () => {
  const { ai, orch } = makeOrchestrator();
  const agent = ai.workforce.getAgent(AGENT_ROLES.PRODUCT_MANAGER);
  agent.execute = ({ options }) =>
    new Promise((resolve, reject) => {
      options.signal.addEventListener("abort", () =>
        reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
      );
    });
  const wf = await orch.createWorkflow("proj_cancel", { name: "Cancel" });
  await assert.rejects(orch.createWorkflow("proj_cancel", {}), /already active/);
  const run = orch.runNextSteps(wf.id);
  await waitFor(() => wf.tasks[0].status === "running");
  orch.cancelWorkflow(wf.id);
  await run;
  assert.equal(wf.status, "cancelled");
  assert.equal(wf.tasks[0].status, "cancelled");
  assert.throws(() => orch.cancelWorkflow(wf.id), /already cancelled/);
});

test("requesting a revision re-runs the gated agent with reviewer feedback", async () => {
  const { ai, orch } = makeOrchestrator();
  const agent = ai.workforce.getAgent(AGENT_ROLES.SYSTEM_ARCHITECT);
  const original = agent.execute.bind(agent);
  const contexts = [];
  agent.execute = async (args) => {
    contexts.push(args.context);
    return original(args);
  };
  const wf = await orch.createWorkflow("proj_rev", { name: "Revise" });
  await orch.runNextSteps(wf.id);
  assert.equal(wf.currentCheckpoint.checkpointType, "architecture_approval");
  assert.throws(
    () => orch.decideCheckpoint(wf.id, "release_approval"),
    /awaiting "architecture_approval"/,
  );

  orch.decideCheckpoint(wf.id, "architecture_approval", {
    approved: false,
    revise: true,
    comments: "Use event sourcing",
  });
  await waitFor(() => wf.status === "awaiting_approval");
  assert.equal(contexts.length, 2);
  assert.deepEqual(contexts[1].reviewFeedback, ["[Human reviewer] Use event sourcing"]);
  const archTask = wf.tasks.find((t) => t.agent === AGENT_ROLES.SYSTEM_ARCHITECT);
  assert.deepEqual(archTask.reviewFindings, []);
  assert.equal(archTask.addressedFindings.length, 1);
});

test("task metadata records provider/model and progress is tracked", async () => {
  const { orch } = makeOrchestrator();
  const wf = await orch.createWorkflow("proj_meta", { name: "Meta" });
  await orch.runNextSteps(wf.id);
  const pm = wf.tasks[0];
  assert.equal(pm.provider, "mock");
  assert.equal(pm.model, "helix-deterministic-mock");
  assert.equal(pm.simulated, true);
  assert.ok(pm.durationMs >= 0);
  assert.equal(wf.progress, Math.round((2 / 9) * 100));
  const office = orch.getOfficeFloorState("proj_meta");
  assert.equal(office.tasks[0].simulated, true);
  assert.equal(office.progress, wf.progress);
});

test("workflows, artifacts, traces and project progress survive a restart", async () => {
  const dir = mkdtempSync(join(tmpdir(), "helix-persist-"));
  const storagePath = join(dir, "state.json");
  try {
    const first = createApp({ storagePath, ai: createAiSubsystem({ mockMode: true }), env: {} });
    const { token } = await signUp(first, "persist@helix.dev");
    const project = await createProject(first, token, "Persistent");
    const started = await call(first, "POST", `/api/v1/projects/${project.id}/workflows`, {
      token,
    });
    await waitFor(
      () => first.ai.orchestrator.getWorkflow(started.json.id).status === "awaiting_approval",
    );
    first.close();

    const raw = JSON.parse(readFileSync(storagePath, "utf8"));
    assert.equal(raw.workflows.length, 1);
    assert.ok(raw.workspaces[0].artifacts.length > 0);

    const second = createApp({ storagePath, ai: createAiSubsystem({ mockMode: true }), env: {} });
    const wf = await call(second, "GET", `/api/v1/projects/${project.id}/workflows`, { token });
    assert.equal(wf.status, 200);
    assert.equal(wf.json.status, "awaiting_approval");
    const artifacts = await call(second, "GET", `/api/v1/projects/${project.id}/artifacts`, {
      token,
    });
    assert.ok(artifacts.json.artifacts.length > 0);
    const traces = await call(second, "GET", `/api/v1/workflows/${wf.json.id}/traces`, { token });
    assert.ok(traces.json.traces.length >= 2);
    const proj = await call(second, "GET", `/api/v1/projects/${project.id}`, { token });
    assert.equal(proj.json.status, "Awaiting Approval");
    assert.equal(proj.json.progress, 22);

    const approved = await call(second, "POST", `/api/v1/workflows/${wf.json.id}/approve`, {
      token,
      body: { checkpointType: "architecture_approval", approved: true },
    });
    assert.equal(approved.json.status, "awaiting_approval");
    assert.equal(approved.json.currentCheckpoint.checkpointType, "release_approval");
    second.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("interrupted running workflows are re-queued and resumed after restart", async () => {
  const { orch } = makeOrchestrator();
  const saved = {
    id: "wf_saved",
    projectId: "proj_saved",
    status: "running",
    currentCheckpoint: null,
    reviewLoopCount: 0,
    createdAt: new Date().toISOString(),
    tasks: [
      {
        id: "t1",
        agent: AGENT_ROLES.PRODUCT_MANAGER,
        title: "PRD",
        status: "running",
        dependencies: [],
        progress: 40,
        reviewFindings: [],
      },
    ],
  };
  orch.attachStorage({ saveWorkflow() {} }, [saved]);
  const wf = orch.getWorkflow("wf_saved");
  assert.equal(wf.status, "pending");
  assert.equal(wf.tasks[0].status, "queued");
  assert.deepEqual(orch.resumeInterrupted(), ["wf_saved"]);
  await waitFor(() => wf.status === "completed");
});

test("project edit API updates the project and the agents' workspace brief", async () => {
  const { app, ai } = makeApp();
  const { token } = await signUp(app, "edit@helix.dev");
  const project = await createProject(app, token);
  await call(app, "POST", `/api/v1/projects/${project.id}/workflows`, { token });
  const res = await call(app, "PATCH", `/api/v1/projects/${project.id}`, {
    token,
    body: { name: "Renamed", description: "New brief", techStack: ["Go", ""] },
  });
  assert.equal(res.status, 200);
  assert.equal(res.json.name, "Renamed");
  assert.deepEqual(res.json.techStack, ["Go"]);
  assert.equal(ai.contextManager.getOrCreateWorkspace(project.id).name, "Renamed");
  assert.equal(
    (
      await call(app, "PATCH", `/api/v1/projects/${project.id}`, {
        token,
        body: { techStack: "Go" },
      })
    ).status,
    400,
  );
  assert.equal(
    (await call(app, "PATCH", `/api/v1/projects/${project.id}`, { token, body: {} })).status,
    400,
  );
});

test("workflow API: GET before start is 404, retry/cancel state conflicts are 409, delete removes workflow", async () => {
  const { app, ai } = makeApp();
  const { token } = await signUp(app, "flow@helix.dev");
  const project = await createProject(app, token);
  assert.equal(
    (await call(app, "GET", `/api/v1/projects/${project.id}/workflows`, { token })).status,
    404,
  );
  const started = await call(app, "POST", `/api/v1/projects/${project.id}/workflows`, { token });
  assert.equal(started.status, 201);
  const again = await call(app, "POST", `/api/v1/projects/${project.id}/workflows`, { token });
  assert.equal(again.status, 200);
  assert.equal(again.json.id, started.json.id);
  await waitFor(() => ai.orchestrator.getWorkflow(started.json.id).status === "awaiting_approval");
  assert.equal(
    (await call(app, "POST", `/api/v1/workflows/${started.json.id}/retry`, { token, body: {} }))
      .status,
    409,
  );
  const wrongGate = await call(app, "POST", `/api/v1/workflows/${started.json.id}/approve`, {
    token,
    body: { checkpointType: "release_approval" },
  });
  assert.equal(wrongGate.status, 409);
  const cancelled = await call(app, "POST", `/api/v1/workflows/${started.json.id}/cancel`, {
    token,
    body: {},
  });
  assert.equal(cancelled.json.status, "cancelled");
  const retried = await call(app, "POST", `/api/v1/workflows/${started.json.id}/retry`, {
    token,
    body: {},
  });
  assert.equal(retried.status, 202);
  const restarted = await call(app, "POST", `/api/v1/projects/${project.id}/workflows`, {
    token,
    body: { restart: true },
  });
  assert.equal(restarted.status, 200, "cannot restart while the retried run is active");

  assert.equal(
    (await call(app, "DELETE", `/api/v1/projects/${project.id}`, { token })).status,
    200,
  );
  assert.equal(ai.orchestrator.getWorkflow(started.json.id), null);
});
