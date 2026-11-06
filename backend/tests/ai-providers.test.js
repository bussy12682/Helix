import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";

import { ModelRouter, AiProviderError } from "../ai/model-router.js";
import { AGENT_ROLES } from "../ai/contracts.js";
import { createAgentWorkforce } from "../ai/agents/index.js";
import { ObservabilityService } from "../ai/observability.js";
import { ToolRegistry } from "../ai/tool-registry.js";

async function localProvider(handler) {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    requests.push({ url: req.url, headers: req.headers, body: JSON.parse(body) });
    await handler(req, res, requests.at(-1));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();
  return { requests, url: `http://127.0.0.1:${port}`, close: () => new Promise((resolve) => server.close(resolve)) };
}

function completion(res, content = '{"ok":true}', usage = { total_tokens: 3 }) {
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ choices: [{ message: { content } }], usage }));
}

const providers = [
  { name: "google", key: "google-key", configure: (url) => ({ aiApiKey: "google-key", aiBaseUrl: `${url}/v1` }) },
  { name: "openai", key: "openai-key", configure: (url) => ({ openAiApiKey: "openai-key", openAiBaseUrl: `${url}/v1` }) },
  { name: "xai", key: "xai-key", configure: (url) => ({ xaiApiKey: "xai-key", xaiBaseUrl: `${url}/v1` }) },
  { name: "ollama", key: "ollama-local-key", configure: (url) => ({ ollamaBaseUrl: url }) },
];

for (const provider of providers) {
  test(`${provider.name} sends an authenticated OpenAI-compatible completion`, async (t) => {
    const remote = await localProvider((_req, res) => completion(res));
    t.after(remote.close);
    const router = new ModelRouter({
      aiProvider: provider.name,
      ...provider.configure(remote.url),
      aiMaxRetries: 0,
      allowMockFallback: false,
    });
    const result = await router.complete({
      agentRole: AGENT_ROLES.BACKEND_ENGINEER,
      messages: [{ role: "user", content: "Return JSON" }],
    });
    assert.equal(result.content, '{"ok":true}');
    assert.equal(result.provider, provider.name);
    assert.equal(result.usage.total_tokens, 3);
    assert.equal(remote.requests.length, 1);
    assert.equal(remote.requests[0].url, "/v1/chat/completions");
    assert.equal(remote.requests[0].headers.authorization, `Bearer ${provider.key}`);
    assert.equal(remote.requests[0].body.response_format.type, "json_object");
    assert.ok(remote.requests[0].body.model.length > 0);
  });
}

test("non-retryable provider errors do not retry or become mock output", async (t) => {
  const remote = await localProvider((_req, res) => {
    res.writeHead(401, { "content-type": "application/json" });
    res.end('{"error":"bad key"}');
  });
  t.after(remote.close);
  const router = new ModelRouter({ aiProvider: "openai", openAiApiKey: "bad", openAiBaseUrl: remote.url, aiMaxRetries: 4, allowMockFallback: true });
  await assert.rejects(router.complete({ agentRole: AGENT_ROLES.PRODUCT_MANAGER, messages: [] }), (error) => {
    assert.ok(error instanceof AiProviderError);
    assert.equal(error.code, "AI_PROVIDER_FAILED");
    assert.equal(error.attempts.length, 1);
    return true;
  });
  assert.equal(remote.requests.length, 1);
});

test("retryable failures use bounded retries and then an explicit fallback provider", async (t) => {
  let primaryCalls = 0;
  const primary = await localProvider((_req, res) => {
    primaryCalls += 1;
    res.writeHead(503);
    res.end("unavailable");
  });
  const fallback = await localProvider((_req, res) => completion(res, '{"fallback":true}'));
  t.after(primary.close);
  t.after(fallback.close);
  const router = new ModelRouter({
    aiProvider: "openai",
    openAiApiKey: "one",
    openAiBaseUrl: primary.url,
    xaiApiKey: "two",
    xaiBaseUrl: fallback.url,
    aiFallbackProviders: "xai",
    aiMaxRetries: 1,
    allowMockFallback: true,
  });
  const result = await router.complete({ agentRole: AGENT_ROLES.QA_ENGINEER, messages: [] });
  assert.equal(result.provider, "xai");
  assert.equal(primaryCalls, 2);
  assert.equal(fallback.requests.length, 1);
});

test("SSE streams preserve split deltas, usage, and a final unterminated frame", async (t) => {
  const remote = await localProvider((_req, res) => {
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.write('data: {"choices":[{"delta":{"content":"hel"}}]}\n\n');
    res.write('data: {"choices":[{"delta":{"content":"lo"}}],"usage":{"total_tokens":2}}\n\n');
    res.end('data: {"choices":[{"delta":{"content":"!"}}]}');
  });
  t.after(remote.close);
  const router = new ModelRouter({ aiProvider: "openai", openAiApiKey: "key", openAiBaseUrl: remote.url });
  const tokens = [];
  const result = await router.complete({ agentRole: AGENT_ROLES.QA_ENGINEER, messages: [], options: { onToken: (token) => tokens.push(token) } });
  assert.equal(result.content, "hello!");
  assert.equal(tokens.join(""), "hello!");
  assert.equal(result.usage.total_tokens, 2);
});

test("all nine registered agents generate validated artifacts in explicit mock mode", async () => {
  const observability = new ObservabilityService();
  const toolRegistry = new ToolRegistry();
  const workforce = createAgentWorkforce({
    modelRouter: new ModelRouter({ mockMode: true }),
    toolRegistry,
    observability,
  });
  const agents = workforce.getAllAgents();
  assert.equal(Object.keys(agents).length, 9);
  for (const [index, role] of Object.keys(agents).entries()) {
    const projectId = `project-${index}`;
    let meta;
    const output = await workforce.getAgent(role).execute({
      workflowId: "workflow-test",
      projectId,
      taskId: `task-${index}`,
      taskTitle: "Exercise the agent contract",
      context: { project: { id: projectId, name: "Test Project" } },
      onMeta: (value) => { meta = value; },
    });
    assert.equal(output.agent, role);
    assert.equal(output.task_id, `task-${index}`);
    assert.equal(meta.provider, "mock");
    assert.ok(output.artifacts.length > 0);
  }
  assert.equal(observability.traces.length, 9);
  assert.ok(observability.traces.every((span) => span.status === "completed"));
});
