import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { makeApp, call, signUp, createProject, waitFor } from "./helpers.js";

async function setup(t) {
  const root = await mkdtemp(path.join(tmpdir(), "helix-workspace-test-"));
  const { app, ai } = makeApp({ env: { HELIX_WORKSPACE_ROOT: root } });
  t.after(async () => {
    app.close();
    await new Promise((resolve) => setTimeout(resolve, 50));
    await rm(root, { recursive: true, force: true });
  });
  const { token } = await signUp(app, `workspace-${crypto.randomUUID()}@example.com`);
  const project = await createProject(app, token, "Executable Workspace");
  return { app, ai, token, project };
}

async function write(app, token, projectId, filePath, content) {
  const response = await call(app, "PUT", `/api/v1/projects/${projectId}/files`, {
    token,
    body: { path: filePath, content },
  });
  assert.equal(response.status, 200, JSON.stringify(response.json));
  return response.json.file;
}

async function waitForJob(app, projectId, jobId) {
  return waitFor(() => {
    const job = app.execution.getJob(projectId, jobId);
    return job?.completedAt ? job : null;
  }, { timeoutMs: 15000 });
}

async function startAndWait(app, token, projectId, route, body = {}) {
  const response = await call(app, "POST", `/api/v1/projects/${projectId}/${route}`, { token, body });
  assert.equal(response.status, 202, JSON.stringify(response.json));
  return waitForJob(app, projectId, response.json.job.id);
}

test("workspace file APIs enforce auth, ownership, versions, and containment", async (t) => {
  const { app, token, project } = await setup(t);
  const unauthorized = await call(app, "GET", `/api/v1/projects/${project.id}/files`);
  assert.equal(unauthorized.status, 401);

  const saved = await write(app, token, project.id, "src/hello.js", "export const hello = 'one';\n");
  assert.equal(saved.version, 1);
  const read = await call(app, "GET", `/api/v1/projects/${project.id}/files?path=${encodeURIComponent("src/hello.js")}`, { token });
  assert.equal(read.status, 200);
  assert.equal(read.json.file.content, "export const hello = 'one';\n");

  const conflict = await call(app, "PUT", `/api/v1/projects/${project.id}/files`, {
    token,
    body: { path: "src/hello.js", content: "changed", expectedVersion: 99 },
  });
  assert.equal(conflict.status, 409);
  const traversal = await call(app, "PUT", `/api/v1/projects/${project.id}/files`, {
    token,
    body: { path: "../outside.js", content: "no" },
  });
  assert.equal(traversal.status, 400);

  const { token: otherToken } = await signUp(app, `other-${crypto.randomUUID()}@example.com`);
  const foreign = await call(app, "GET", `/api/v1/projects/${project.id}/files`, { token: otherToken });
  assert.equal(foreign.status, 403);

  const removed = await call(app, "DELETE", `/api/v1/projects/${project.id}/files?path=${encodeURIComponent("src/hello.js")}`, { token });
  assert.equal(removed.status, 200);
  assert.equal((await call(app, "GET", `/api/v1/projects/${project.id}/files?path=src%2Fhello.js`, { token })).status, 404);
  await assert.rejects(app.workspace.readDiskFile(project.id, "src/hello.js"), { code: "ENOENT" });
});

test("terminal jobs emit real output and report failures, limits, and blocked executables", async (t) => {
  const { app, token, project } = await setup(t);
  await write(app, token, project.id, "index.js", "console.log('REAL_STDOUT'); console.error('REAL_STDERR');\n");
  const events = [];
  const listener = (event) => events.push(event);
  app.execution.on("event", listener);
  t.after(() => app.execution.off("event", listener));

  const job = await startAndWait(app, token, project.id, "execute", { command: "node index.js" });
  assert.equal(job.status, "completed");
  assert.equal(job.result.exitCode, 0);
  assert.match(job.result.stdout, /REAL_STDOUT/);
  assert.match(job.result.stderr, /REAL_STDERR/);
  assert.ok(events.some((event) => event.type === "execution_output" && event.payload.data.includes("REAL_STDOUT")));
  assert.ok(events.some((event) => event.type === "execution_completed"));

  const failed = await startAndWait(app, token, project.id, "execute", { command: "node -e \"process.exit(7)\"" });
  assert.equal(failed.status, "failed");
  assert.equal(failed.result.exitCode, 7);

  const timedOut = await startAndWait(app, token, project.id, "execute", { command: "node -e \"setTimeout(() => {}, 5000)\"", timeoutMs: 150 });
  assert.equal(timedOut.status, "failed");
  assert.equal(timedOut.result.timedOut, true);

  const hostRead = await startAndWait(app, token, project.id, "execute", { command: "node -e \"require('fs').readFileSync('/etc/passwd')\"" });
  assert.equal(hostRead.status, "failed");

  const outputLimited = await startAndWait(app, token, project.id, "execute", {
    command: "node -e \"process.stdout.write('x'.repeat(2 * 1024 * 1024))\"",
  });
  assert.equal(outputLimited.status, "failed");
  assert.equal(outputLimited.result.outputTruncated, true);
  assert.ok(outputLimited.result.stdout.length <= 1024 * 1024);

  const blocked = await call(app, "POST", `/api/v1/projects/${project.id}/execute`, { token, body: { command: "sh -c id" } });
  assert.equal(blocked.status, 400);
});

test("execution SSE streams snapshots, output, and completion for only the authorized project", async (t) => {
  const { app, token, project } = await setup(t);
  const response = await app.request(`http://localhost/api/v1/projects/${project.id}/executions/stream?token=${encodeURIComponent(token)}`);
  assert.equal(response.status, 200);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  async function nextEvent() {
    while (!buffer.includes("\n\n")) {
      const { done, value } = await reader.read();
      if (done) throw new Error("SSE ended early");
      buffer += decoder.decode(value, { stream: true });
    }
    const end = buffer.indexOf("\n\n");
    const frame = buffer.slice(0, end);
    buffer = buffer.slice(end + 2);
    const data = frame.split("\n").find((line) => line.startsWith("data: "));
    return data ? JSON.parse(data.slice(6)) : null;
  }
  while (true) {
    const event = await nextEvent();
    if (event?.type === "execution_snapshot") break;
  }
  const started = await call(app, "POST", `/api/v1/projects/${project.id}/execute`, {
    token,
    body: { command: "node -e \"console.log('SSE_REAL_OUTPUT')\"" },
  });
  assert.equal(started.status, 202);
  const types = [];
  let sawOutput = false;
  for (let index = 0; index < 20; index += 1) {
    const event = await nextEvent();
    if (!event) continue;
    types.push(event.type);
    if (event.type === "execution_output" && event.payload.data.includes("SSE_REAL_OUTPUT")) sawOutput = true;
    if (event.type === "execution_completed") break;
  }
  await reader.cancel();
  assert.equal(sawOutput, true);
  assert.ok(types.includes("execution_completed"));
});

async function writeRunnableApplication(app, token, projectId) {
  await write(app, token, projectId, "package.json", JSON.stringify({
    name: "helix-runnable-fixture",
    private: true,
    type: "commonjs",
    scripts: {
      test: "node --test sample.test.js",
      build: "node build.js",
      start: "node server.js",
    },
  }, null, 2));
  await write(app, token, projectId, "page.html", "<!doctype html><head><title>HELIX Fixture</title><script src=\"/client.js\"></script></head><h1>HELIX_LIVE_PREVIEW</h1>\n");
  await write(app, token, projectId, "client.js", "window.loadFixtureData = () => fetch('/api/data').then((response) => response.json());\n");
  await write(app, token, projectId, "build.js", "const fs = require('fs'); fs.mkdirSync('dist', { recursive: true }); fs.copyFileSync('page.html', 'dist/index.html'); fs.copyFileSync('client.js', 'dist/client.js'); console.log('REAL_BUILD_COMPLETE');\n");
  await write(app, token, projectId, "sample.test.js", "const test = require('node:test'); const assert = require('node:assert'); test('real arithmetic', () => assert.equal(2 + 2, 4));\n");
  await write(app, token, projectId, "server.js", `
const http = require('http');
const fs = require('fs');
const html = fs.readFileSync('page.html', 'utf8');
const server = http.createServer((req, res) => {
  if (req.url.startsWith('/api/data')) {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ real: true }));
    return;
  }
  if (req.url === '/client.js') {
    res.writeHead(200, { 'content-type': 'text/javascript' });
    res.end(fs.readFileSync('client.js'));
    return;
  }
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end(html);
});
server.listen(Number(process.env.PORT), '127.0.0.1', () => console.log('REAL_PREVIEW_READY'));
`);
}

test("a generated application installs, tests, builds, runs, proxies preview, and stops", async (t) => {
  const { app, token, project } = await setup(t);
  await writeRunnableApplication(app, token, project.id);

  const installed = await startAndWait(app, token, project.id, "install");
  assert.equal(installed.status, "completed", JSON.stringify(installed.result));
  assert.equal(installed.result.sandbox.network, "enabled-for-this-lifecycle-operation");
  await waitFor(async () => {
    const files = await call(app, "GET", `/api/v1/projects/${project.id}/files`, { token });
    return files.json.files.some((file) => file.path === "package-lock.json");
  });

  const tested = await startAndWait(app, token, project.id, "tests");
  assert.equal(tested.status, "completed", JSON.stringify(tested.result));
  assert.equal(tested.result.status, "PASS");
  assert.match(tested.result.stdout, /pass 1/);

  const built = await startAndWait(app, token, project.id, "build");
  assert.equal(built.status, "completed", JSON.stringify(built.result));
  assert.match(built.result.stdout, /REAL_BUILD_COMPLETE/);

  const preview = await call(app, "POST", `/api/v1/projects/${project.id}/preview/start`, { token, body: { port: 3001 } });
  assert.equal(preview.status, 200, JSON.stringify(preview.json));
  assert.equal(preview.json.preview.status, "ready");
  assert.equal(preview.json.preview.mode, "server");
  assert.match(preview.json.preview.url, /\/preview\/[\w-]+\/$/);
  assert.notEqual(app.applications.previews.get(project.id).port, 3001);

  const previewUrl = new URL(preview.json.preview.url, "http://localhost");
  const page = await app.request(previewUrl);
  assert.equal(page.status, 200);
  assert.equal(page.headers.get("x-frame-options"), null);
  assert.match(page.headers.get("content-security-policy") ?? "", /frame-ancestors /);
  const html = await page.text();
  assert.match(html, /HELIX_LIVE_PREVIEW/);
  assert.match(html, /<base href=/);
  assert.ok(html.includes(`src="${previewUrl.pathname}client.js"`));

  const asset = await app.request(new URL("client.js", previewUrl));
  assert.equal(asset.status, 200);
  assert.match(await asset.text(), /loadFixtureData/);
  const data = await app.request(new URL("api/data", previewUrl));
  assert.equal(data.status, 200);
  assert.deepEqual(await data.json(), { real: true });

  const unauthorized = await app.request(`http://localhost/api/v1/projects/${project.id}/preview/`);
  assert.equal(unauthorized.status, 401);
  const stopped = await call(app, "POST", `/api/v1/projects/${project.id}/preview/stop`, { token, body: {} });
  assert.equal(stopped.status, 200);
  previewUrl.searchParams.set("retry", "1");
  const afterStop = await app.request(previewUrl);
  assert.equal(afterStop.status, 404);
});

test("all nine explicit mock agents produce a coherent installable and previewable application", async (t) => {
  const { app, ai, token, project } = await setup(t);
  for (const [index, role] of Object.keys(ai.workforce.getAllAgents()).entries()) {
    const output = await ai.workforce.getAgent(role).execute({
      workflowId: "workflow-offline-lifecycle",
      projectId: project.id,
      taskId: `offline-task-${index}`,
      taskTitle: "Generate the coherent offline starter",
      context: { project: { id: project.id, name: project.name, description: project.description } },
    });
    assert.equal(output.agent, role);
    // The orchestrator performs this same persistence step after each agent task completes.
    for (const artifact of output.artifacts) {
      ai.contextManager.saveArtifact(project.id, { ...artifact, createdBy: role, taskId: `offline-task-${index}` });
    }
  }
  const paths = app.workspace.list(project.id).map((file) => file.path);
  for (const required of ["package.json", "server.js", "public/index.html", "public/app.js", "tests/routes.test.js", "Dockerfile"]) {
    assert.ok(paths.includes(required), `Missing generated artifact ${required}`);
  }

  const installed = await startAndWait(app, token, project.id, "install");
  assert.equal(installed.status, "completed", JSON.stringify(installed.result));
  const tested = await startAndWait(app, token, project.id, "tests");
  assert.equal(tested.status, "completed", JSON.stringify(tested.result));
  assert.match(tested.result.stdout, /pass 4/);
  const built = await startAndWait(app, token, project.id, "build");
  assert.equal(built.status, "completed", JSON.stringify(built.result));
  assert.match(built.result.stdout, /Static application built into dist/);

  const started = await call(app, "POST", `/api/v1/projects/${project.id}/preview/start`, { token, body: {} });
  assert.equal(started.status, 200, JSON.stringify(started.json));
  const previewUrl = new URL(started.json.preview.url, "http://localhost");
  const page = await app.request(previewUrl);
  assert.match(await page.text(), /Explicitly simulated generation/);
  const script = await app.request(new URL("app.js", previewUrl));
  assert.equal(script.status, 200);
  const resources = await app.request(new URL("api/v1/resources", previewUrl));
  assert.equal(resources.status, 200);
  assert.equal((await resources.json()).items[0].id, "welcome");
  await call(app, "POST", `/api/v1/projects/${project.id}/preview/stop`, { token, body: {} });
});

test("AI repair is an unverified, explicitly simulated proposal in mock mode", async (t) => {
  const { app, token, project } = await setup(t);
  await write(app, token, project.id, "index.js", "throw new Error('broken');\n");
  const failed = await startAndWait(app, token, project.id, "execute", { command: "node index.js" });
  assert.equal(failed.status, "failed");
  const repair = await call(app, "POST", `/api/v1/projects/${project.id}/repair`, {
    token,
    body: { jobId: failed.id, filePath: "index.js" },
  });
  assert.equal(repair.status, 200, JSON.stringify(repair.json));
  assert.equal(repair.json.simulated, true);
  assert.equal(repair.json.verified, false);
  assert.equal(repair.json.basedOnJobId, failed.id);
  const original = await call(app, "GET", `/api/v1/projects/${project.id}/files?path=index.js`, { token });
  assert.equal(original.json.file.content, "throw new Error('broken');\n");

  // The deterministic offline draft proposes a concrete minimal replacement for the selected file.
  const proposal = repair.json.files.find((file) => file.path === "index.js");
  assert.ok(proposal, "repair proposal addresses the selected failing file");
  assert.match(proposal.content, /Handled previously thrown failure/);
  assert.doesNotMatch(proposal.content, /throw new Error/);

  // Applying is an explicit reviewed save; the rerun reports the real result.
  await write(app, token, project.id, "index.js", proposal.content);
  const rerun = await startAndWait(app, token, project.id, "execute", { command: "node index.js" });
  assert.equal(rerun.status, "completed");
  assert.equal(rerun.result.exitCode, 0);
  assert.match(rerun.result.stderr, /Handled previously thrown failure: broken/);
});
