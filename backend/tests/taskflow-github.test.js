import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { GitHubService, GitHubExportError } from "../github-service.js";
import { makeApp, call, signUp, createProject } from "./helpers.js";

async function workspaceSetup(t) {
  const root = await mkdtemp(path.join(tmpdir(), "helix-taskflow-test-"));
  const { app } = makeApp({ env: { HELIX_WORKSPACE_ROOT: root } });
  t.after(async () => {
    app.close();
    await new Promise((resolve) => setTimeout(resolve, 50));
    await rm(root, { recursive: true, force: true });
  });
  const { token } = await signUp(app, `taskflow-${crypto.randomUUID()}@example.com`);
  const project = await createProject(app, token, "TASKFLOW Integration");
  return { app, token, project };
}

test("TASKFLOW runs real dependency-ordered jobs, blocks dependents after failure, and enforces ownership", async (t) => {
  const { app, token, project } = await workspaceSetup(t);
  const invalid = await call(app, "POST", `/api/v1/projects/${project.id}/taskflows`, {
    token,
    body: {
      tasks: [
        { id: "one", command: "node --version", dependencies: ["two"] },
        { id: "two", command: "node --version", dependencies: ["one"] },
      ],
    },
  });
  assert.equal(invalid.status, 400);
  assert.equal(invalid.json.error.code, "INVALID_TASKFLOW");

  const created = await call(app, "POST", `/api/v1/projects/${project.id}/taskflows`, {
    token,
    body: {
      name: "Real dependency graph",
      tasks: [
        { id: "first", command: "node -e \"console.log('FIRST_REAL_TASK')\"" },
        { id: "second", command: "node -e \"console.log('SECOND_REAL_TASK')\"", dependencies: ["first"] },
        { id: "failure", command: "node -e \"process.exit(4)\"", dependencies: ["second"] },
        { id: "blocked", command: "node -e \"console.log('MUST_NOT_RUN')\"", dependencies: ["failure"] },
      ],
    },
  });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  const planId = created.json.id;
  const run = await call(app, "POST", `/api/v1/projects/${project.id}/taskflows/${planId}/run`, { token, body: {} });
  assert.equal(run.status, 200, JSON.stringify(run.json));
  assert.equal(run.json.status, "failed");
  const statuses = Object.fromEntries(run.json.tasks.map((task) => [task.id, task.status]));
  assert.deepEqual(statuses, { first: "completed", second: "completed", failure: "failed", blocked: "blocked" });
  assert.match(run.json.tasks[0].result.stdout, /FIRST_REAL_TASK/);
  assert.match(run.json.tasks[1].result.stdout, /SECOND_REAL_TASK/);
  assert.equal(run.json.tasks[2].result.exitCode, 4);
  assert.equal(run.json.tasks[3].result.executed, false);
  assert.equal(app.store.listTaskflows().find((plan) => plan.id === planId).status, "failed");

  const { token: otherToken } = await signUp(app, `other-taskflow-${crypto.randomUUID()}@example.com`);
  const foreign = await call(app, "POST", `/api/v1/projects/${project.id}/taskflows/${planId}/run`, {
    token: otherToken,
    body: {},
  });
  assert.equal(foreign.status, 403);
  const foreignList = await call(app, "GET", `/api/v1/projects/${project.id}/taskflows`, { token: otherToken });
  assert.equal(foreignList.status, 403);
});

test("TASKFLOW can rerun a recovered graph without stale blocked statuses", async (t) => {
  const { app, token, project } = await workspaceSetup(t);
  const created = await call(app, "POST", `/api/v1/projects/${project.id}/taskflows`, {
    token,
    body: {
      tasks: [
        { id: "check", command: "node -e \"process.exit(1)\"" },
        { id: "after", command: "node -e \"console.log('RECOVERED')\"", dependencies: ["check"] },
      ],
    },
  });
  const planId = created.json.id;
  const first = await call(app, "POST", `/api/v1/projects/${project.id}/taskflows/${planId}/run`, { token, body: {} });
  assert.equal(first.json.tasks[1].status, "blocked");

  // Simulate repairing the underlying command definition, then verify a fresh run resets every task.
  app.taskflow.getOwned(project.id, planId).tasks[0].command = "node -e \"console.log('FIXED')\"";
  const second = await call(app, "POST", `/api/v1/projects/${project.id}/taskflows/${planId}/run`, { token, body: {} });
  assert.equal(second.status, 200);
  assert.equal(second.json.status, "completed");
  assert.deepEqual(second.json.tasks.map((task) => task.status), ["completed", "completed"]);
  assert.match(second.json.tasks[1].result.stdout, /RECOVERED/);
});

async function fakeGitHub(t) {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    const record = { method: req.method, path: req.url, headers: req.headers, body: body ? JSON.parse(body) : null };
    requests.push(record);
    res.setHeader("content-type", "application/json");
    if (req.method === "POST" && req.url === "/user/repos") {
      res.end(JSON.stringify({ name: "demo", full_name: "octo/demo", html_url: "https://example.test/octo/demo", default_branch: "main", owner: { login: "octo" } }));
    } else if (req.method === "GET" && req.url === "/repos/octo/demo/git/ref/heads/main") {
      res.end(JSON.stringify({ object: { sha: "parent-sha" } }));
    } else if (req.method === "GET" && req.url === "/repos/octo/demo/git/commits/parent-sha") {
      res.end(JSON.stringify({ tree: { sha: "base-tree" } }));
    } else if (req.method === "POST" && req.url === "/repos/octo/demo/git/blobs") {
      res.end(JSON.stringify({ sha: `blob-${requests.filter((item) => item.path.endsWith("/git/blobs")).length}` }));
    } else if (req.method === "POST" && req.url === "/repos/octo/demo/git/trees") {
      res.end(JSON.stringify({ sha: "new-tree" }));
    } else if (req.method === "POST" && req.url === "/repos/octo/demo/git/commits") {
      res.end(JSON.stringify({ sha: "new-commit" }));
    } else if (req.method === "PATCH" && req.url === "/repos/octo/demo/git/refs/heads/main") {
      res.end(JSON.stringify({ object: { sha: "new-commit" } }));
    } else {
      res.writeHead(404);
      res.end(JSON.stringify({ message: "Unexpected local test route" }));
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return { requests, url: `http://127.0.0.1:${server.address().port}` };
}

test("GitHub export creates blobs, a tree and a non-force commit through the Git Data API", async (t) => {
  const remote = await fakeGitHub(t);
  const service = new GitHubService({ token: "local-test-token", apiBaseUrl: remote.url });
  const result = await service.exportProject({
    repoName: "demo",
    description: "Local API contract test",
    artifacts: [
      { path: "README.md", content: "# Demo\n" },
      { path: "src/index.js", content: "console.log('real export payload');\n" },
    ],
  });
  assert.deepEqual(result, {
    repository: "octo/demo",
    repositoryUrl: "https://example.test/octo/demo",
    branch: "main",
    commitSha: "new-commit",
    filesExported: 2,
  });
  const blobs = remote.requests.filter((request) => request.path.endsWith("/git/blobs"));
  assert.equal(blobs.length, 2);
  assert.equal(Buffer.from(blobs[0].body.content, "base64").toString("utf8"), "# Demo\n");
  const tree = remote.requests.find((request) => request.path.endsWith("/git/trees"));
  assert.equal(tree.body.base_tree, "base-tree");
  assert.deepEqual(tree.body.tree.map((entry) => entry.path), ["README.md", "src/index.js"]);
  const update = remote.requests.find((request) => request.method === "PATCH");
  assert.equal(update.body.force, false);
  assert.equal(update.body.sha, "new-commit");
  assert.ok(remote.requests.every((request) => request.headers.authorization === "Bearer local-test-token"));
});

test("GitHub export fails closed without configuration and validates repository names", async () => {
  const service = new GitHubService({ token: "" });
  await assert.rejects(
    service.exportProject({ repoName: "demo", artifacts: [{ path: "index.js", content: "" }] }),
    (error) => error instanceof GitHubExportError && error.code === "GITHUB_NOT_CONFIGURED",
  );
  const configured = new GitHubService({ token: "not-used" });
  await assert.rejects(
    configured.exportProject({ repoName: "../invalid", artifacts: [{ path: "index.js", content: "" }] }),
    (error) => error instanceof GitHubExportError && error.code === "INVALID_REPOSITORY",
  );
});
