import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

import { createNodeHandler } from "../http-adapter.js";
import { makeApp, signUp, createProject } from "./helpers.js";

test("real HTTP server streams scoped workflow events over SSE in real time", async () => {
  const { app } = makeApp();
  const server = http.createServer(createNodeHandler(app));
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const controller = new AbortController();
  try {
    const { token } = await signUp(app, "sse@helix.dev");
    const project = await createProject(app, token, "Streamed");
    const otherProject = await createProject(app, token, "Other");

    const res = await fetch(
      `${base}/api/v1/projects/${project.id}/workflows/stream?token=${token}`,
      { signal: controller.signal },
    );
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type"), /text\/event-stream/);

    const events = [];
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    const readUntil = async (predicate) => {
      while (!events.some(predicate)) {
        const { value, done } = await reader.read();
        if (done) throw new Error("stream ended");
        buffer += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buffer.indexOf("\n\n")) >= 0) {
          const frame = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          const data = frame.split("\n").find((l) => l.startsWith("data: "));
          if (data) events.push(JSON.parse(data.slice(6)));
        }
      }
    };

    await readUntil((e) => e.type === "office_snapshot");
    assert.equal(events[0].type, "connected");

    // Start another project's workflow first: its events must not leak into this stream.
    await fetch(`${base}/api/v1/projects/${otherProject.id}/workflows`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
    });
    const start = await fetch(`${base}/api/v1/projects/${project.id}/workflows`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
    });
    assert.equal(start.status, 201);

    await readUntil((e) => e.type === "checkpoint_reached");
    const types = events.map((e) => e.type);
    for (const t of [
      "workflow_created",
      "task_started",
      "task_stream",
      "task_completed",
      "checkpoint_reached",
    ]) {
      assert.ok(types.includes(t), `expected ${t} in ${types.join(",")}`);
    }
    for (const e of events.filter((ev) => ev.payload?.projectId)) {
      assert.equal(e.payload.projectId, project.id);
    }
  } finally {
    controller.abort();
    await new Promise((r) => server.close(r));
  }
});

test("HTTP adapter streams request bodies and enforces auth on the stream", async () => {
  const { app } = makeApp();
  const server = http.createServer(createNodeHandler(app));
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const noAuth = await fetch(`${base}/api/v1/projects/x/workflows/stream`);
    assert.equal(noAuth.status, 401);
    const bad = await fetch(`${base}/api/v1/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{oops",
    });
    assert.equal(bad.status, 400);
    const health = await fetch(`${base}/api/v1/health`);
    const json = await health.json();
    assert.equal(json.status, "healthy");
    assert.equal(json.storage, "memory");
    assert.equal(json.ai.mode, "mock");
  } finally {
    await new Promise((r) => server.close(r));
  }
});
