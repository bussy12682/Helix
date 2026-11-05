import test from "node:test";
import assert from "node:assert/strict";

import { ModelRouter, AiProviderError } from "../ai/model-router.js";
import { AGENT_ROLES } from "../ai/contracts.js";

const messages = [{ role: "user", content: '{"taskId":"t1","context":{"project":{"name":"X"}}}' }];
const ok = (content = '{"ok":true}') =>
  new Response(
    JSON.stringify({ choices: [{ message: { content } }], usage: { total_tokens: 3 } }),
    {
      status: 200,
      headers: { "content-type": "application/json" },
    },
  );

function router(fetchImpl, extra = {}) {
  return new ModelRouter({
    aiProvider: "openai",
    openAiApiKey: "sk-real",
    xaiApiKey: "xai-real",
    aiRetryBaseDelayMs: 1,
    fetchImpl,
    ...extra,
  });
}

test("retries transient provider errors with backoff then succeeds", async () => {
  let n = 0;
  const r = router(async () => (++n < 3 ? new Response("busy", { status: 503 }) : ok()));
  const res = await r.complete({ agentRole: AGENT_ROLES.QA_ENGINEER, messages });
  assert.equal(n, 3);
  assert.equal(res.provider, "openai");
  assert.equal(res.content, '{"ok":true}');
});

test("does not retry non-retryable 4xx and falls back to the next configured provider", async () => {
  const seen = [];
  const r = router(
    async (url) => {
      seen.push(url);
      return url.includes("openai") ? new Response("bad key", { status: 401 }) : ok();
    },
    { aiFallbackProviders: "xai" },
  );
  const res = await r.complete({ agentRole: AGENT_ROLES.QA_ENGINEER, messages });
  assert.equal(res.provider, "xai");
  assert.equal(seen.filter((u) => u.includes("openai")).length, 1);
});

test("a failing real provider surfaces an error instead of silently returning mock output", async () => {
  const r = router(async () => new Response("rate limited", { status: 429 }), { aiMaxRetries: 1 });
  await assert.rejects(r.complete({ agentRole: AGENT_ROLES.QA_ENGINEER, messages }), (err) => {
    assert.ok(err instanceof AiProviderError);
    assert.equal(err.code, "AI_PROVIDER_FAILED");
    assert.equal(err.attempts.length, 2);
    return true;
  });
});

test("network failures and timeouts are retried and reported", async () => {
  let n = 0;
  const r = router(
    async () => {
      n += 1;
      throw new TypeError("fetch failed");
    },
    { aiMaxRetries: 2 },
  );
  await assert.rejects(
    r.complete({ agentRole: AGENT_ROLES.QA_ENGINEER, messages }),
    /Network error/,
  );
  assert.equal(n, 3);
});

test("with no provider configured, mock is only used when explicitly allowed", async () => {
  const offline = async () => {
    throw new TypeError("ollama down");
  };
  const strict = new ModelRouter({
    aiProvider: "openai",
    openAiApiKey: "",
    allowMockFallback: false,
    fetchImpl: offline,
  });
  await assert.rejects(
    strict.complete({ agentRole: AGENT_ROLES.QA_ENGINEER, messages }),
    (err) => err.code === "AI_NOT_CONFIGURED",
  );

  const lenient = new ModelRouter({
    aiProvider: "openai",
    openAiApiKey: "your-key",
    allowMockFallback: true,
    fetchImpl: offline,
  });
  const res = await lenient.complete({ agentRole: AGENT_ROLES.QA_ENGINEER, messages });
  assert.equal(res.provider, "mock");
  assert.equal(lenient.getStatus().configuredProviders.length, 0);
});

test("streams token deltas from an SSE completion response", async () => {
  const frames = ['{"a"', ":", "1}"].map(
    (d) => `data: ${JSON.stringify({ choices: [{ delta: { content: d } }] })}\n\n`,
  );
  const body = new ReadableStream({
    start(c) {
      for (const f of frames) c.enqueue(new TextEncoder().encode(f));
      c.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
      c.close();
    },
  });
  let sentBody;
  const r = router(async (_url, init) => {
    sentBody = JSON.parse(init.body);
    return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
  });
  const tokens = [];
  const res = await r.complete({
    agentRole: AGENT_ROLES.QA_ENGINEER,
    messages,
    options: { onToken: (t) => tokens.push(t) },
  });
  assert.equal(sentBody.stream, true);
  assert.deepEqual(tokens, ['{"a"', ":", "1}"]);
  assert.equal(res.content, '{"a":1}');
});

test("caller cancellation aborts without retrying", async () => {
  const controller = new AbortController();
  let n = 0;
  const r = router(
    (_url, init) =>
      new Promise((_, reject) => {
        n += 1;
        init.signal.addEventListener("abort", () =>
          reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
        );
      }),
  );
  const p = r.complete({
    agentRole: AGENT_ROLES.QA_ENGINEER,
    messages,
    options: { signal: controller.signal },
  });
  controller.abort();
  await assert.rejects(p, (err) => err.name === "AbortError");
  assert.equal(n, 1);
});
