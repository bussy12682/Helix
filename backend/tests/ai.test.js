import test from "node:test";
import assert from "node:assert/strict";

import { analyzeProjectBrief, respondToVoiceTurn, transcribeVoiceNote } from "../ai.js";

test("analyzes a project brief through an OpenAI-compatible provider", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    assert.equal(url, "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions");
    assert.equal(options.headers.authorization, "Bearer test-google-key");

    const body = JSON.parse(options.body);
    assert.equal(body.model, "gemini-2.5-flash");
    assert.equal(body.response_format.type, "json_object");
    assert.equal(body.messages[1].content.includes("Who are the first customers?"), true);

    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                name: "Helix Shop",
                description: "A storefront for independent makers.",
                keyFeatures: ["Catalog", "Checkout"],
                techStack: ["React", "PostgreSQL"],
              }),
            },
          },
        ],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };

  try {
    const analysis = await analyzeProjectBrief(
      {
        name: "Helix Shop",
        description: "A storefront for independent makers.",
        conversation: [{ role: "assistant", content: "Who are the first customers?" }],
      },
      {
        aiProvider: "google",
        aiApiKey: "test-google-key",
        aiModel: "gemini-2.5-flash",
        aiBaseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
      },
    );

    assert.equal(analysis.provider, "google");
    assert.equal(analysis.simulated, false);
    assert.ok(analysis.keyFeatures.includes("Catalog"));
    assert.ok(analysis.keyFeatures.includes("Checkout"));
    assert.ok(analysis.keyFeatures.length >= 4);
    assert.deepEqual(analysis.techStack, ["React", "PostgreSQL"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("replaces feature sentences copied from the description", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                name: "Maker Market",
                description:
                  "A marketplace for local makers where sellers can publish products and buyers can place orders.",
                keyFeatures: [
                  "A marketplace for local makers where sellers can publish products and buyers can place orders.",
                ],
                techStack: ["React", "TypeScript", "Node.js", "PostgreSQL", "Tailwind CSS"],
              }),
            },
          },
        ],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );

  try {
    const analysis = await analyzeProjectBrief(
      {
        name: "Maker Market",
        description:
          "A marketplace for local makers where sellers can publish products and buyers can place orders.",
      },
      {
        aiProvider: "xai",
        aiApiKey: "test-key",
        aiModel: "test-model",
        aiBaseUrl: "https://api.example.com",
      },
    );

    assert.equal(analysis.keyFeatures[0], "Primary user workflow");
    assert.equal(
      analysis.keyFeatures.some((feature) => feature.includes("marketplace for local makers")),
      false,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("transcribes a voice note through the configured Gemini provider", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    assert.equal(
      url,
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=test-google-key",
    );
    assert.equal(options.headers["content-type"], "application/json");
    const body = JSON.parse(options.body);
    assert.equal(body.contents[0].parts[0].text.includes("Transcribe this voice note"), true);
    assert.equal(body.contents[0].parts[1].inlineData.mimeType, "audio/webm");

    return new Response(
      JSON.stringify({
        candidates: [{ content: { parts: [{ text: "We need a marketplace for local makers." }] } }],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };

  try {
    const transcript = await transcribeVoiceNote(
      { audio: Buffer.from("voice-note"), mimeType: "audio/webm" },
      {
        aiProvider: "google",
        aiApiKey: "test-google-key",
        aiModel: "gemini-2.5-flash",
        googleAiModel: "gemini-3.6-flash",
      },
    );

    assert.equal(transcript, "We need a marketplace for local makers.");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("responds to a voice turn with conversational context", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    assert.equal(url, "https://api.example.com/chat/completions");
    const body = JSON.parse(options.body);
    assert.equal(body.messages.at(-1).content, "We need a marketplace for local makers.");
    assert.equal(body.messages.at(-1).role, "user");

    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: "That sounds useful. Who are the first customers you want to serve?",
            },
          },
        ],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };

  try {
    const reply = await respondToVoiceTurn(
      {
        name: "Maker Market",
        messages: [{ role: "user", content: "We need a marketplace for local makers." }],
      },
      {
        aiProvider: "openai",
        aiApiKey: "test-key",
        aiModel: "test-model",
        aiBaseUrl: "https://api.example.com",
      },
    );

    assert.equal(reply, "That sounds useful. Who are the first customers you want to serve?");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("does not disguise a rate-limited voice provider with a fabricated reply", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("{}", { status: 429 });

  try {
    await assert.rejects(
      respondToVoiceTurn(
        {
          name: "Maker Market",
          messages: [{ role: "user", content: "A marketplace for local makers." }],
        },
        {
          aiProvider: "openai",
          aiApiKey: "test-key",
          aiModel: "test-model",
          aiBaseUrl: "https://api.example.com",
        },
      ),
      (error) => error.code === "AI_RATE_LIMITED",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("does not disguise a rate-limited analysis provider with a fallback summary", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("{}", { status: 429 });

  try {
    await assert.rejects(
      analyzeProjectBrief(
        {
          name: "Maker Market",
          description: "A marketplace for local makers. Sellers need simple listings.",
        },
        {
          aiProvider: "openai",
          aiApiKey: "test-key",
          aiModel: "test-model",
          aiBaseUrl: "https://api.example.com",
        },
      ),
      (error) => error.code === "AI_RATE_LIMITED",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("labels keyless development drafts and disables them when fallback is not allowed", async () => {
  const input = { name: "Maker Market", description: "A marketplace for local makers." };
  const draft = await analyzeProjectBrief(input, { aiProvider: "google", allowMockFallback: true });
  assert.equal(draft.simulated, true);
  assert.equal(draft.provider, "offline-draft");
  assert.match(draft.warning, /No live AI provider/);

  await assert.rejects(
    analyzeProjectBrief(input, { aiProvider: "google", allowMockFallback: false }),
    (error) => error.code === "AI_NOT_CONFIGURED",
  );
});
