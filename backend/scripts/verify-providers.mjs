#!/usr/bin/env node
/**
 * HELIX live AI provider verification.
 *
 * Makes a REAL completion call through the production ModelRouter transport for
 * every provider that has credentials configured, and reports the actual
 * outcome — latency, model, provider-reported token usage, or the exact error.
 *
 * Honesty rules:
 *  - Providers without usable keys are reported as SKIP with the env var to set.
 *    They are never simulated, and a skip does not fail the run.
 *  - Mock fallback is disabled (`allowMockFallback: false`): a "pass" can only
 *    come from a real HTTP 200 with content from the provider.
 *  - Any ATTEMPTED provider that fails makes the process exit 1.
 *
 * Usage:
 *   npm run verify:providers
 *   GOOGLE_AI_API_KEY=... OPENAI_API_KEY=... npm run verify:providers
 */

import { existsSync } from "node:fs";

const envFile = existsSync(".env.local") ? ".env.local" : ".env";
if (typeof process.loadEnvFile === "function" && existsSync(envFile)) {
  process.loadEnvFile(envFile);
}

const { loadConfig } = await import("../config.js");
const { ModelRouter } = await import("../ai/model-router.js");
const { AGENT_ROLES } = await import("../ai/contracts.js");

const config = loadConfig(process.env);

const router = new ModelRouter({
  ...config,
  mockMode: false,
  allowMockFallback: false,
  // Keep the check quick; retries still apply per provider policy.
  timeoutMs: Math.min(config.aiTimeoutMs || 120000, 30000),
});

const PLACEHOLDER_KEY = /^(your[-_]|replace[-_]|sk[-_]?your|change[-_]me)/i;
const usable = (value) => Boolean(value) && !PLACEHOLDER_KEY.test(value);

// The effective routing chain production will actually use.
const chain = [
  config.aiProvider,
  ...(config.aiFallbackProviders || "")
    .split(",")
    .map((provider) => provider.trim())
    .filter(Boolean),
];

/**
 * A provider is ATTEMPTED only when production could actually route to it AND
 * the ModelRouter would send a usable credential for it:
 *
 *  - routable: in the effective chain (primary or fallback), or it has its own
 *    dedicated key so an operator can verify a provider before adding it to
 *    the chain. The generic AI_API_KEY intentionally does NOT count for
 *    google/xai — the ModelRouter would send it to the wrong vendor and the
 *    400 would be noise, not signal.
 *  - credentialed: router.hasUsableKey() — exactly the key resolution the
 *    production transport uses (placeholder-style values are rejected there).
 *
 * Chain membership alone never triggers an attempt: with the default
 * AI_PROVIDER=google and no keys, google is an honest SKIP, not a failure.
 */
const inChain = (name) => chain.includes(name);
const attempt = (name, dedicatedKey) =>
  router.hasUsableKey(name) && (inChain(name) || usable(dedicatedKey));
const providers = [
  {
    name: "google",
    label: "Google Gemini",
    envVars: ["GOOGLE_AI_API_KEY (as AI_PROVIDER=google, or in AI_FALLBACK_PROVIDERS)"],
    configured: () => attempt("google", config.googleAiApiKey),
  },
  {
    name: "openai",
    label: "OpenAI",
    envVars: ["AI_API_KEY (as AI_PROVIDER=openai, or in AI_FALLBACK_PROVIDERS)"],
    configured: () => attempt("openai", config.openAiApiKey),
  },
  {
    name: "xai",
    label: "xAI Grok",
    envVars: ["XAI_API_KEY (as AI_PROVIDER=xai, or in AI_FALLBACK_PROVIDERS)"],
    configured: () => attempt("xai", config.xaiApiKey),
  },
  {
    name: "ollama",
    label: "Ollama (local)",
    envVars: ["OLLAMA_BASE_URL"],
    configured: () => Boolean(config.ollamaBaseUrl),
  },
];

function maskKey(value) {
  if (!value) return "(unset)";
  if (value.length <= 8) return "***";
  return `${value.slice(0, 4)}…${value.slice(-2)} (${value.length} chars)`;
}

const keyFor = {
  google: () => config.googleAiApiKey || config.aiApiKey,
  openai: () => config.openAiApiKey || config.aiApiKey,
  xai: () => config.xaiApiKey,
  ollama: () => "n/a (local server)",
};

console.log("HELIX provider verification");
console.log(`  primary provider : ${config.aiProvider}`);
console.log(`  fallback chain   : ${config.aiFallbackProviders || "(none)"}`);
console.log(`  mock fallback    : disabled for verification\n`);

const results = [];

for (const provider of providers) {
  if (!provider.configured()) {
    console.log(
      `SKIP  ${provider.label.padEnd(18)} no credentials — set ${provider.envVars.join(", ")}`,
    );
    results.push({ provider: provider.name, status: "skipped" });
    continue;
  }

  const resolution = router.resolveModel(AGENT_ROLES.QA_ENGINEER, { provider: provider.name });
  const startedAt = Date.now();
  try {
    const result = await router.complete({
      agentRole: AGENT_ROLES.QA_ENGINEER,
      messages: [
        {
          role: "user",
          content:
            'Connectivity check. Reply with a tiny JSON object: {"ok":true} and nothing else.',
        },
      ],
      temperature: 0,
      options: { provider: provider.name },
    });
    const latencyMs = Date.now() - startedAt;
    if (!result?.content) {
      throw new Error("provider returned an empty completion");
    }
    if (result.provider === "mock") {
      throw new Error("mock output produced — mock fallback must be disabled for verification");
    }
    const usage = result.usage
      ? `${result.usage.prompt_tokens ?? "?"}+${result.usage.completion_tokens ?? "?"}=${result.usage.total_tokens ?? "?"} tokens`
      : "usage not reported";
    console.log(
      `PASS  ${provider.label.padEnd(18)} ${resolution.model} via ${result.provider} — ${latencyMs}ms — ${usage}`,
    );
    console.log(`      key ${maskKey(keyFor[provider.name]?.())}`);
    console.log(`      reply: ${JSON.stringify(result.content.slice(0, 120))}`);
    results.push({ provider: provider.name, status: "passed", latencyMs, model: resolution.model });
  } catch (error) {
    const detail = error?.status ? ` (HTTP ${error.status})` : "";
    console.error(
      `FAIL  ${provider.label.padEnd(18)} ${resolution.model}${detail} — ${error.message}`,
    );
    if (error?.attempts) {
      console.error(`      attempts: ${JSON.stringify(error.attempts)}`);
    }
    results.push({ provider: provider.name, status: "failed", error: error.message });
  }
}

const attempted = results.filter((r) => r.status !== "skipped");
const failed = results.filter((r) => r.status === "failed");
const passed = results.filter((r) => r.status === "passed");

console.log(
  `\nSummary: ${passed.length} passed, ${failed.length} failed, ${results.length - attempted.length} skipped (no credentials).`,
);

if (attempted.length === 0) {
  console.log(
    "\nNo providers were verifiable: no API keys are configured in this environment.\n" +
      "This is an honest skip — HELIX does not fake live-provider verification.\n" +
      "Set at least one of GOOGLE_AI_API_KEY / AI_API_KEY / XAI_API_KEY / OLLAMA_BASE_URL\n" +
      "(see .env.example) and rerun npm run verify:providers.",
  );
  process.exit(0);
}

if (failed.length > 0) {
  console.error(
    "\nVerification FAILED for configured provider(s) — see above. Not production-ready.",
  );
  process.exit(1);
}

console.log("All configured providers verified against their live endpoints.");
process.exit(0);
