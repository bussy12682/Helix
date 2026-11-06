/**
 * HELIX AI Engineering Operating System — Model Router & Abstraction
 * Routes requests dynamically based on agent role, task complexity, latency,
 * and cost. Supports Google Gemini, OpenAI, xAI, Ollama, and offline mocks.
 */

import { AGENT_ROLES } from "./contracts.js";

export const MODEL_TIERS = {
  REASONING: "reasoning", // High capability, deep planning, threat modeling
  CODING: "coding", // Precision code generation, syntax accuracy
  FAST: "fast", // Quick triage, validation, documentation, QA test runs
};

export const ROLE_TO_TIER_MAP = {
  [AGENT_ROLES.PRODUCT_MANAGER]: MODEL_TIERS.REASONING,
  [AGENT_ROLES.SYSTEM_ARCHITECT]: MODEL_TIERS.REASONING,
  [AGENT_ROLES.SECURITY_ENGINEER]: MODEL_TIERS.REASONING,
  [AGENT_ROLES.DATABASE_ENGINEER]: MODEL_TIERS.CODING,
  [AGENT_ROLES.BACKEND_ENGINEER]: MODEL_TIERS.CODING,
  [AGENT_ROLES.FRONTEND_ENGINEER]: MODEL_TIERS.CODING,
  [AGENT_ROLES.QA_ENGINEER]: MODEL_TIERS.FAST,
  [AGENT_ROLES.DEVOPS_ENGINEER]: MODEL_TIERS.FAST,
  [AGENT_ROLES.DOCUMENTATION_ENGINEER]: MODEL_TIERS.FAST,
};

const RETRYABLE_STATUS = new Set([408, 409, 425, 429, 500, 502, 503, 504]);
const PLACEHOLDER_KEY = /^(your[-_]|replace[-_]|sk[-_]?your|change[-_]me)/i;

export class AiProviderError extends Error {
  constructor(
    message,
    { code = "AI_PROVIDER_ERROR", status = null, provider = null, attempts = [] } = {},
  ) {
    super(message);
    this.name = "AiProviderError";
    this.code = code;
    this.status = status;
    this.provider = provider;
    this.attempts = attempts;
  }
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
      },
      { once: true },
    );
  });
}

export class ModelRouter {
  constructor(config = {}) {
    this.config = config;
    this.defaultProvider = config.aiProvider || "google";
    this.ollamaBaseUrl = (
      config.ollamaBaseUrl ||
      process.env.OLLAMA_BASE_URL ||
      "http://localhost:11434"
    ).replace(/\/$/, "");
    this.mockMode = config.mockMode || process.env.HELIX_MOCK_AI === "true";
    this.fallbackProviders = (config.aiFallbackProviders ?? process.env.AI_FALLBACK_PROVIDERS ?? "")
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean);
    // Simulated output is never used to mask a failing real provider. It is only used when no
    // provider is configured at all, and only if explicitly allowed (default: non-production).
    this.allowMockFallback =
      config.allowMockFallback ??
      (process.env.HELIX_ALLOW_MOCK_FALLBACK
        ? process.env.HELIX_ALLOW_MOCK_FALLBACK === "true"
        : process.env.NODE_ENV !== "production");
    this.maxRetries = Math.max(
      0,
      Math.min(5, Number(config.aiMaxRetries ?? process.env.AI_MAX_RETRIES ?? 2) || 0),
    );
    this.timeoutMs = Math.max(
      1,
      Number(config.aiTimeoutMs ?? process.env.AI_TIMEOUT_MS ?? 120000) || 120000,
    );
    this.retryBaseDelayMs = Math.max(0, Number(config.aiRetryBaseDelayMs ?? 0) || 0);
    this.fetchImpl = config.fetchImpl ?? ((...args) => fetch(...args));
  }

  hasUsableKey(provider) {
    if (provider === "ollama") return true;
    const key = this.getApiKey(provider);
    return Boolean(key) && !PLACEHOLDER_KEY.test(key);
  }

  /**
   * Describes routing configuration for health/status endpoints (no secrets).
   */
  getStatus() {
    const chain = [this.defaultProvider, ...this.fallbackProviders];
    return {
      mode: this.mockMode ? "mock" : "live",
      primaryProvider: this.defaultProvider,
      fallbackProviders: this.fallbackProviders,
      configuredProviders: chain.filter((p) => this.hasUsableKey(p)),
      mockFallbackAllowed: this.allowMockFallback,
    };
  }

  /**
   * Resolves the target model and provider based on agent role and request options.
   */
  resolveModel(agentRole, options = {}) {
    const tier = options.tier || ROLE_TO_TIER_MAP[agentRole] || MODEL_TIERS.FAST;
    const provider = options.provider || this.defaultProvider;

    let modelName =
      options.model ||
      (provider === this.defaultProvider ? this.config.aiModel : "") ||
      "gemini-2.5-flash";

    if (provider === "google") {
      if (tier === MODEL_TIERS.REASONING)
        modelName = this.config.googleReasoningModel || "gemini-2.5-pro";
      else if (tier === MODEL_TIERS.CODING)
        modelName = this.config.googleCodingModel || "gemini-2.5-flash";
      else modelName = this.config.googleFastModel || "gemini-2.5-flash";
    } else if (provider === "openai") {
      if (tier === MODEL_TIERS.REASONING) modelName = this.config.openAiReasoningModel || "gpt-4o";
      else if (tier === MODEL_TIERS.CODING)
        modelName = this.config.openAiCodingModel || "gpt-4o-mini";
      else modelName = this.config.openAiFastModel || "gpt-4o-mini";
    } else if (provider === "xai") {
      if (tier === MODEL_TIERS.REASONING) modelName = this.config.xaiReasoningModel || "grok-3";
      else if (tier === MODEL_TIERS.CODING) modelName = this.config.xaiCodingModel || "grok-3-mini";
      else modelName = this.config.xaiFastModel || "grok-3-mini";
    } else if (provider === "ollama") {
      if (tier === MODEL_TIERS.REASONING)
        modelName = this.config.ollamaReasoningModel || "llama3.1:8b";
      else if (tier === MODEL_TIERS.CODING)
        modelName = this.config.ollamaCodingModel || "qwen2.5-coder:7b";
      else modelName = this.config.ollamaFastModel || "qwen2.5:3b";
    }

    return {
      provider,
      tier,
      model: modelName,
      baseUrl: this.getBaseUrl(provider),
      apiKey: this.getApiKey(provider),
    };
  }

  getBaseUrl(provider) {
    if (provider === "google") {
      return (
        this.config.aiBaseUrl || "https://generativelanguage.googleapis.com/v1beta/openai"
      ).replace(/\/$/, "");
    }
    if (provider === "openai") {
      return (this.config.openAiBaseUrl || "https://api.openai.com/v1").replace(/\/$/, "");
    }
    if (provider === "xai") {
      return (this.config.xaiBaseUrl || "https://api.x.ai/v1").replace(/\/$/, "");
    }
    if (provider === "ollama") {
      return `${this.ollamaBaseUrl}/v1`;
    }
    return "";
  }

  getApiKey(provider) {
    if (provider === "google")
      return (
        this.config.aiApiKey || this.config.googleAiApiKey || process.env.GOOGLE_AI_API_KEY || ""
      );
    if (provider === "openai")
      return this.config.openAiApiKey || this.config.aiApiKey || process.env.AI_API_KEY || "";
    if (provider === "xai") return this.config.xaiApiKey || process.env.XAI_API_KEY || "";
    if (provider === "ollama") return "ollama-local-key";
    return "";
  }

  /**
   * Operational usage policy (token budgets). When set, every real provider
   * call is authorized before dispatch and accounted after with the
   * provider-reported usage. Mock output is free and never counted.
   */
  setUsagePolicy(policy) {
    this.usagePolicy = policy;
  }

  /**
   * Invokes a completion with role-based routing, per-provider retries with exponential backoff,
   * timeouts, cancellation (options.signal), optional token streaming (options.onToken), and an
   * explicit fallback provider chain (AI_FALLBACK_PROVIDERS).
   */
  async complete({ agentRole, messages, temperature = 0.2, options = {} }) {
    const policy = this.usagePolicy;
    // Mock output is free: budgets neither gate nor account simulated calls.
    if (!policy || this.mockMode || options.forceMock) {
      return this.completeInternal({ agentRole, messages, temperature, options });
    }
    const usageContext = policy.enrich
      ? policy.enrich(options.usageContext ?? {})
      : (options.usageContext ?? {});
    policy.authorize?.(usageContext);
    const result = await this.completeInternal({ agentRole, messages, temperature, options });
    if (result?.provider && result.provider !== "mock" && result.usage) {
      policy.record?.(usageContext, result);
    }
    return result;
  }

  async completeInternal({ agentRole, messages, temperature = 0.2, options = {} }) {
    if (this.mockMode || options.forceMock) {
      return this.emitMock(this.generateMockResponse(agentRole, messages), options);
    }

    const chain = [
      ...new Set([options.provider || this.defaultProvider, ...this.fallbackProviders]),
    ];
    const candidates = chain.filter((provider) => this.hasUsableKey(provider));

    if (candidates.length === 0) {
      // Nothing configured: try a local Ollama server, then (if allowed) clearly-labelled mock output.
      try {
        const ollama = await this.tryOllama(agentRole, messages, temperature);
        if (ollama?.content) return ollama;
      } catch {
        // Ollama not reachable.
      }
      if (this.allowMockFallback) {
        return this.emitMock(this.generateMockResponse(agentRole, messages), options);
      }
      throw new AiProviderError(
        `No AI provider is configured (tried: ${chain.join(", ")}). Set an API key or enable HELIX_MOCK_AI.`,
        { code: "AI_NOT_CONFIGURED" },
      );
    }

    const attempts = [];
    for (const provider of candidates) {
      const resolution = this.resolveModel(agentRole, { ...options, provider });
      try {
        return await this.callWithRetries(resolution, { messages, temperature, options, attempts });
      } catch (error) {
        if (error.name === "AbortError" || options.signal?.aborted) throw error;
        console.warn(`[ModelRouter] Provider ${provider} failed: ${error.message}`);
      }
    }

    const last = attempts.at(-1);
    throw new AiProviderError(
      `All AI providers failed (${attempts.map((a) => `${a.provider}#${a.attempt}: ${a.error}`).join("; ")})`,
      {
        code: "AI_PROVIDER_FAILED",
        status: last?.status ?? null,
        provider: last?.provider ?? null,
        attempts,
      },
    );
  }

  async callWithRetries(resolution, { messages, temperature, options, attempts }) {
    let lastError;
    for (let attempt = 1; attempt <= this.maxRetries + 1; attempt += 1) {
      try {
        return await this.callProvider(resolution, { messages, temperature, options });
      } catch (error) {
        lastError = error;
        attempts.push({
          provider: resolution.provider,
          attempt,
          status: error.status ?? null,
          error: error.message,
        });
        if (error.name === "AbortError" && options.signal?.aborted) throw error;
        const retryable = error.retryable ?? true;
        if (!retryable || attempt > this.maxRetries) break;
        const backoff = error.retryAfterMs ?? this.retryBaseDelayMs * 2 ** (attempt - 1);
        await sleep(Math.min(backoff, 10000), options.signal);
      }
    }
    throw lastError;
  }

  async callProvider(resolution, { messages, temperature, options }) {
    const stream = typeof options.onToken === "function";
    const timeoutSignal = AbortSignal.timeout(this.timeoutMs);
    const signal = options.signal
      ? AbortSignal.any([options.signal, timeoutSignal])
      : timeoutSignal;
    const startTime = Date.now();

    let response;
    try {
      response = await this.fetchImpl(`${resolution.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${resolution.apiKey}`,
        },
        body: JSON.stringify({
          model: resolution.model,
          temperature,
          response_format: { type: "json_object" },
          messages,
          ...(stream ? { stream: true } : {}),
        }),
        signal,
      });
    } catch (error) {
      if (options.signal?.aborted) throw error;
      const wrapped = new AiProviderError(
        timeoutSignal.aborted
          ? `Request timed out after ${this.timeoutMs}ms`
          : `Network error: ${error.message}`,
        { code: "AI_PROVIDER_UNAVAILABLE", provider: resolution.provider },
      );
      wrapped.retryable = true;
      throw wrapped;
    }

    if (!response.ok) {
      const detail = (await response.text().catch(() => "")).slice(0, 300);
      const error = new AiProviderError(
        `${resolution.provider} returned HTTP ${response.status}${detail ? `: ${detail}` : ""}`,
        { code: "AI_PROVIDER_FAILED", status: response.status, provider: resolution.provider },
      );
      error.retryable = RETRYABLE_STATUS.has(response.status);
      const retryAfter = Number(response.headers.get("retry-after"));
      if (Number.isFinite(retryAfter) && retryAfter > 0) error.retryAfterMs = retryAfter * 1000;
      throw error;
    }

    let content = "";
    let usage = null;
    const contentType = response.headers.get("content-type") || "";
    if (stream && contentType.includes("text/event-stream") && response.body) {
      ({ content, usage } = await this.readStream(response.body, options.onToken));
    } else {
      const json = await response.json();
      content = json?.choices?.[0]?.message?.content ?? "";
      usage = json.usage || null;
      if (stream && content) options.onToken(content);
    }

    if (!content) {
      const error = new AiProviderError("AI provider returned empty message content", {
        code: "AI_EMPTY_RESPONSE",
        provider: resolution.provider,
      });
      error.retryable = true;
      throw error;
    }

    return {
      content,
      provider: resolution.provider,
      model: resolution.model,
      tier: resolution.tier,
      durationMs: Date.now() - startTime,
      usage,
    };
  }

  /**
   * Parses an OpenAI-compatible SSE completion stream, forwarding content deltas.
   */
  async readStream(body, onToken) {
    const decoder = new TextDecoder();
    let buffer = "";
    let content = "";
    let usage = null;
    for await (const chunk of body) {
      buffer += decoder.decode(chunk, { stream: true });
      let newline;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (data === "[DONE]") return { content, usage };
        try {
          const json = JSON.parse(data);
          const delta = json?.choices?.[0]?.delta?.content;
          if (delta) {
            content += delta;
            onToken(delta);
          }
          if (json.usage) usage = json.usage;
        } catch {
          // Ignore keep-alives and partial frames.
        }
      }
    }
    buffer += decoder.decode();
    const finalLine = buffer.trim();
    if (finalLine.startsWith("data:")) {
      const data = finalLine.slice(5).trim();
      if (data && data !== "[DONE]") {
        try {
          const json = JSON.parse(data);
          const delta = json?.choices?.[0]?.delta?.content;
          if (delta) {
            content += delta;
            onToken(delta);
          }
          if (json.usage) usage = json.usage;
        } catch {
          // A truncated final event is not a valid completion delta.
        }
      }
    }
    return { content, usage };
  }

  emitMock(result, options = {}) {
    if (typeof options.onToken === "function") options.onToken(result.content);
    return result;
  }

  async tryOllama(agentRole, messages, temperature) {
    const resolution = this.resolveModel(agentRole, { provider: "ollama" });
    const probe = await this.fetchImpl(`${this.ollamaBaseUrl}/api/tags`, {
      signal: AbortSignal.timeout(1500),
    });
    if (!probe.ok) return null;
    const startTime = Date.now();
    const response = await this.fetchImpl(`${resolution.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: resolution.model,
        temperature,
        response_format: { type: "json_object" },
        messages,
      }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!response.ok) return null;
    const json = await response.json();
    return {
      content: json?.choices?.[0]?.message?.content ?? "",
      provider: "ollama",
      model: resolution.model,
      tier: resolution.tier,
      durationMs: Date.now() - startTime,
      usage: json.usage || null,
    };
  }

  /**
   * Deterministic mock generator producing structurally compliant output
   * for each of the 9 agents during testing or offline demo.
   */
  generateMockResponse(agentRole, messages) {
    const lastUserMsg = [...messages].reverse().find((m) => m.role === "user")?.content || "";
    let parsedInput = {};
    try {
      parsedInput = JSON.parse(lastUserMsg);
    } catch {
      parsedInput = { prompt: lastUserMsg };
    }

    const projectName = parsedInput.name || parsedInput.projectName || "HELIX System";

    // Repair tasks carry a real execution failure in their context. The deterministic
    // offline draft must address that failure instead of returning the generic starter set.
    const failureInput = parsedInput.context?.failure;
    if (failureInput && typeof failureInput === "object") {
      return this.generateMockRepairResponse(agentRole, parsedInput, failureInput);
    }

    const mockBodies = {
      [AGENT_ROLES.PRODUCT_MANAGER]: {
        agent: AGENT_ROLES.PRODUCT_MANAGER,
        status: "completed",
        task_id: "TASK-001",
        summary: `Defined comprehensive PRD and user stories for ${projectName}.`,
        artifacts: [
          {
            name: "prd.md",
            type: "spec",
            path: "docs/prd.md",
            content: `# Product Requirements Document: ${projectName}\n\n## 1. Executive Summary\n${projectName} is an explicitly simulated HELIX starter that demonstrates a real runnable workspace without external services.\n\n## 2. Target Personas\n- Developers evaluating the HELIX workspace\n- End users inspecting the generated starter\n\n## 3. User Stories\n- US-1: As a user, I can load the deterministic resource list from the running API.\n- US-2: As a developer, I can run the executable tests and production build locally.\n- US-3: As a developer, I can identify that generation was simulated and review the documented limitations.`,
          },
        ],
        decisions: [
          { key: "target_release", decision: "MVP v1.0", rationale: "Focus on core user journeys" },
        ],
        dependencies: [],
        risks: [{ description: "Scope creep in MVP phase", severity: "medium" }],
        next_actions: [AGENT_ROLES.SYSTEM_ARCHITECT],
      },

      [AGENT_ROLES.SYSTEM_ARCHITECT]: {
        agent: AGENT_ROLES.SYSTEM_ARCHITECT,
        status: "completed",
        task_id: "TASK-002",
        summary: `Formulated system architecture, REST API contracts, and data topology for ${projectName}.`,
        artifacts: [
          {
            name: "architecture.md",
            type: "spec",
            path: "docs/architecture.md",
            content: `# System Architecture: ${projectName}\n\n## Architecture Style\nDependency-free modular monolith serving static browser assets and JSON from one Node.js process.\n\n## Technology Stack\n- Frontend: HTML, CSS, and browser JavaScript in public/\n- Backend: Node.js HTTP runtime with routes in src/api/\n- Data: Deterministic in-memory read-only fixture; no database connection\n\n## Runtime Contract\nThe server respects HOST and PORT. The build copies public/ into dist/, and production mode serves dist/ when it exists.`,
          },
          {
            name: "openapi-spec.json",
            type: "spec",
            path: "docs/api-spec.json",
            content: JSON.stringify(
              {
                openapi: "3.0.0",
                info: { title: projectName, version: "1.0.0" },
                paths: {
                  "/api/v1/health": { get: { responses: { 200: { description: "Healthy" } } } },
                  "/api/v1/resources": {
                    get: { responses: { 200: { description: "List resources" } } },
                  },
                },
              },
              null,
              2,
            ),
          },
        ],
        decisions: [
          {
            key: "api_protocol",
            decision: "RESTful JSON",
            rationale: "Standardized client consumption",
          },
          {
            key: "persistence",
            decision: "Deterministic in-memory fixture",
            rationale: "Keeps the offline starter runnable without external services",
          },
        ],
        dependencies: ["TASK-001"],
        risks: [
          {
            description:
              "The fixture has no persistence or authentication and is not a production application",
            severity: "medium",
          },
        ],
        next_actions: [AGENT_ROLES.DATABASE_ENGINEER, AGENT_ROLES.FRONTEND_ENGINEER],
      },

      [AGENT_ROLES.DATABASE_ENGINEER]: {
        agent: AGENT_ROLES.DATABASE_ENGINEER,
        status: "completed",
        task_id: "TASK-003",
        summary: `Documented the deterministic read-only data fixture and its lack of persistence.`,
        artifacts: [
          {
            name: "README.md",
            type: "doc",
            path: "database/README.md",
            content: `# Offline data fixture\n\nThe starter deliberately uses no database. src/api/service.js returns a deterministic in-memory resource list. No SQL migration runs and no user data is persisted. Add a real database, migrations, access controls, and integration tests before using generated output as a production data service.`,
          },
        ],
        decisions: [
          {
            key: "id_strategy",
            decision: "Stable fixture identifiers",
            rationale: "Deterministic API responses make offline tests reproducible",
          },
        ],
        dependencies: ["TASK-002"],
        risks: [],
        next_actions: [AGENT_ROLES.BACKEND_ENGINEER],
      },

      [AGENT_ROLES.BACKEND_ENGINEER]: {
        agent: AGENT_ROLES.BACKEND_ENGINEER,
        status: "completed",
        task_id: "TASK-004",
        summary: `Implemented modular API routes, business logic, validation, and error middleware.`,
        artifacts: [
          {
            name: "package.json",
            type: "config",
            path: "package.json",
            content: JSON.stringify(
              {
                name: "helix-offline-starter",
                version: "1.0.0",
                private: true,
                description: "Explicitly simulated HELIX starter application",
                scripts: {
                  dev: "node server.js",
                  start: "node server.js",
                  build: "node scripts/build.js",
                  test: "node --test tests/*.test.js",
                },
                engines: { node: ">=22" },
              },
              null,
              2,
            ),
          },
          {
            name: "server.js",
            type: "code",
            path: "server.js",
            content: `const http = require('node:http');\nconst fs = require('node:fs');\nconst path = require('node:path');\nconst { handleApi } = require('./src/api/routes');\n\nconst publicRoot = path.resolve(__dirname, process.env.NODE_ENV === 'production' && fs.existsSync(path.join(__dirname, 'dist')) ? 'dist' : 'public');\nconst types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };\nconst server = http.createServer((req, res) => {\n  if (handleApi(req, res)) return;\n  const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);\n  const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\\/+/, '');\n  const file = path.resolve(publicRoot, relative);\n  if (file !== publicRoot && !file.startsWith(publicRoot + path.sep)) {\n    res.writeHead(400).end('Invalid path');\n    return;\n  }\n  fs.readFile(file, (error, content) => {\n    if (error) { res.writeHead(404).end('Not found'); return; }\n    res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream' });\n    res.end(content);\n  });\n});\nconst port = Number(process.env.PORT || 3000);\nconst host = process.env.HOST || '127.0.0.1';\nserver.listen(port, host, () => console.log('Offline starter listening on http://' + host + ':' + port));`,
          },
          {
            name: "routes.js",
            type: "code",
            path: "src/api/routes.js",
            content: `const { listResources } = require('./service');\n\nfunction json(res, status, payload) {\n  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });\n  res.end(JSON.stringify(payload));\n}\nfunction handleApi(req, res) {\n  const pathname = new URL(req.url, 'http://localhost').pathname;\n  if (pathname === '/api/v1/health') { json(res, 200, { ok: true }); return true; }\n  if (pathname === '/api/v1/resources') { json(res, 200, { items: listResources() }); return true; }\n  return pathname.startsWith('/api/') ? (json(res, 404, { error: 'Not found' }), true) : false;\n}\nmodule.exports = { handleApi };`,
          },
          {
            name: "service.js",
            type: "code",
            path: "src/api/service.js",
            content: `function listResources() {\n  return [{ id: 'welcome', name: 'HELIX offline starter', status: 'ready' }];\n}\nmodule.exports = { listResources };`,
          },
          {
            name: "build.js",
            type: "code",
            path: "scripts/build.js",
            content: `const fs = require('node:fs');\nconst path = require('node:path');\nconst output = path.resolve(__dirname, '..', 'dist');\nfs.rmSync(output, { recursive: true, force: true });\nfs.cpSync(path.resolve(__dirname, '..', 'public'), output, { recursive: true });\nconsole.log('Static application built into dist/');`,
          },
        ],
        decisions: [
          {
            key: "error_handling",
            decision: "Centralized error format",
            rationale: "Consistent client errors",
          },
        ],
        dependencies: ["TASK-002", "TASK-003"],
        risks: [],
        next_actions: [AGENT_ROLES.SECURITY_ENGINEER, AGENT_ROLES.QA_ENGINEER],
      },

      [AGENT_ROLES.FRONTEND_ENGINEER]: {
        agent: AGENT_ROLES.FRONTEND_ENGINEER,
        status: "completed",
        task_id: "TASK-005",
        summary: `Implemented a dependency-free browser UI and live API client for the offline starter.`,
        artifacts: [
          {
            name: "index.html",
            type: "code",
            path: "public/index.html",
            content: `<!doctype html>\n<html lang="en">\n<head>\n  <meta charset="utf-8">\n  <meta name="viewport" content="width=device-width, initial-scale=1">\n  <title>HELIX Offline Starter</title>\n  <link rel="stylesheet" href="/styles.css">\n</head>\n<body>\n  <main>\n    <p class="eyebrow">Explicitly simulated generation · real running app</p>\n    <h1>HELIX Offline Starter</h1>\n    <p>This deterministic mock project is executing in the isolated workspace.</p>\n    <button id="load">Load real API data</button>\n    <pre id="output">No request made yet.</pre>\n  </main>\n  <script src="/app.js"></script>\n</body>\n</html>`,
          },
          {
            name: "app.js",
            type: "code",
            path: "public/app.js",
            content: `const button = document.querySelector('#load');\nconst output = document.querySelector('#output');\nbutton.addEventListener('click', async () => {\n  button.disabled = true;\n  output.textContent = 'Loading…';\n  try {\n    const response = await fetch('/api/v1/resources');\n    if (!response.ok) throw new Error('HTTP ' + response.status);\n    output.textContent = JSON.stringify(await response.json(), null, 2);\n  } catch (error) {\n    output.textContent = error.message;\n  } finally {\n    button.disabled = false;\n  }\n});`,
          },
          {
            name: "styles.css",
            type: "code",
            path: "public/styles.css",
            content: `:root { font-family: system-ui, sans-serif; color: #e8e9f2; background: #0d0f18; }\nbody { margin: 0; display: grid; min-height: 100vh; place-items: center; }\nmain { width: min(680px, 90vw); padding: 3rem; border: 1px solid #343a52; border-radius: 20px; background: #161927; }\nh1 { margin-top: 0; }\n.eyebrow { color: #a89bff; font-size: .8rem; }\nbutton { padding: .75rem 1rem; border: 0; border-radius: 8px; background: #8b7cff; color: #10111a; font-weight: 700; cursor: pointer; }\npre { min-height: 5rem; padding: 1rem; white-space: pre-wrap; color: #b8bfd8; background: #0d0f18; border-radius: 8px; }`,
          },
        ],
        decisions: [
          {
            key: "ui_toolkit",
            decision: "Dependency-free HTML, CSS, and browser JavaScript",
            rationale: "Runs offline without undeclared packages or manual scaffolding",
          },
        ],
        dependencies: ["TASK-002"],
        risks: [],
        next_actions: [AGENT_ROLES.QA_ENGINEER],
      },

      [AGENT_ROLES.SECURITY_ENGINEER]: {
        agent: AGENT_ROLES.SECURITY_ENGINEER,
        status: "completed",
        task_id: "TASK-006",
        summary: `Prepared a deterministic offline threat-model draft; no live dependency audit was executed.`,
        artifacts: [
          {
            name: "security-audit.md",
            type: "spec",
            path: "docs/security-audit.md",
            content: `# Offline Security Review Draft\n\nThis deterministic mock artifact is not a completed security audit.\n\n## Observed scope\n- The starter exposes public read-only health and resource endpoints; it implements no authentication.\n- The starter uses no database, SQL, secrets, or third-party runtime packages.\n- HELIX supplies the isolated preview boundary; the generated server itself is not a security sandbox.\n\n## Review checklist\n- Bind to loopback for local preview and explicitly choose exposure for containers.\n- Add authentication and authorization before storing or changing private data.\n- Add security headers, request limits, and rate limiting for an Internet-facing deployment.\n- Run dependency and static-analysis scans after adding real dependencies.`,
          },
        ],
        decisions: [
          {
            key: "network_exposure",
            decision: "Loopback by default; explicit container exposure",
            rationale:
              "The public fixture has no authentication and must not be exposed unintentionally",
          },
        ],
        dependencies: ["TASK-004"],
        risks: [
          {
            description:
              "Do not deploy the unauthenticated fixture as a private production service",
            severity: "medium",
          },
        ],
        next_actions: [AGENT_ROLES.DEVOPS_ENGINEER],
      },

      [AGENT_ROLES.QA_ENGINEER]: {
        agent: AGENT_ROLES.QA_ENGINEER,
        status: "completed",
        task_id: "TASK-007",
        summary: `Authored executable offline regression tests and a QA plan; the agent did not execute them.`,
        artifacts: [
          {
            name: "service.test.js",
            type: "code",
            path: "tests/service.test.js",
            content: `const test = require('node:test');\nconst assert = require('node:assert/strict');\nconst { listResources } = require('../src/api/service');\n\ntest('resource service returns the deterministic welcome fixture', () => {\n  assert.deepEqual(listResources(), [{ id: 'welcome', name: 'HELIX offline starter', status: 'ready' }]);\n});`,
          },
          {
            name: "routes.test.js",
            type: "code",
            path: "tests/routes.test.js",
            content: `const test = require('node:test');\nconst assert = require('node:assert/strict');\nconst { handleApi } = require('../src/api/routes');\n\nfunction request(path) {\n  const response = { status: null, headers: null, body: null };\n  const res = {\n    writeHead(status, headers) { response.status = status; response.headers = headers; return this; },\n    end(body) { response.body = JSON.parse(body); },\n  };\n  const handled = handleApi({ url: path }, res);\n  return { handled, response };\n}\n\ntest('health route returns a healthy JSON response', () => {\n  const { handled, response } = request('/api/v1/health');\n  assert.equal(handled, true);\n  assert.equal(response.status, 200);\n  assert.deepEqual(response.body, { ok: true });\n});\n\ntest('resource route returns the service data', () => {\n  const { response } = request('/api/v1/resources');\n  assert.equal(response.status, 200);\n  assert.equal(response.body.items[0].id, 'welcome');\n});\n\ntest('unknown API routes return JSON 404 and browser routes pass through', () => {\n  assert.equal(request('/api/v1/missing').response.status, 404);\n  assert.equal(request('/').handled, false);\n});`,
          },
          {
            name: "test-plan.md",
            type: "spec",
            path: "docs/test-plan.md",
            content: `# Offline QA Test Plan\n\nThe QA agent authored tests but did not execute them. Run npm test in the workspace to execute the real regression suite.\n\n- TC-01: Verify the health endpoint response.\n- TC-02: Verify the resource service and route return the deterministic fixture.\n- TC-03: Verify unknown API routes return JSON 404 and browser routes reach static handling.\n- TC-04: Run npm run build and inspect the generated dist/ files.\n\nRelease Candidate Status: UNVERIFIED until these commands pass outside the agent.`,
          },
        ],
        decisions: [],
        dependencies: ["TASK-004", "TASK-005"],
        risks: [],
        next_actions: [AGENT_ROLES.DEVOPS_ENGINEER],
      },

      [AGENT_ROLES.DEVOPS_ENGINEER]: {
        agent: AGENT_ROLES.DEVOPS_ENGINEER,
        status: "completed",
        task_id: "TASK-008",
        summary: `Created Docker and CI definitions matching the generated Node entrypoint and scripts; no deployment was performed.`,
        artifacts: [
          {
            name: "Dockerfile",
            type: "config",
            path: "Dockerfile",
            content: `FROM node:22-alpine AS builder\nWORKDIR /app\nCOPY package.json ./\nRUN npm install --ignore-scripts --no-audit --no-fund\nCOPY public ./public\nCOPY scripts ./scripts\nRUN npm run build\n\nFROM node:22-alpine\nENV NODE_ENV=production HOST=0.0.0.0 PORT=3000\nWORKDIR /app\nCOPY package.json server.js ./\nCOPY src ./src\nCOPY --from=builder /app/dist ./dist\nUSER node\nEXPOSE 3000\nCMD ["node", "server.js"]`,
          },
          {
            name: "docker-compose.yml",
            type: "config",
            path: "docker-compose.yml",
            content: `services:\n  app:\n    build: .\n    environment:\n      HOST: 0.0.0.0\n      PORT: 3000\n    ports:\n      - "3000:3000"\n    read_only: true\n    tmpfs:\n      - /tmp`,
          },
          {
            name: ".env.example",
            type: "config",
            path: ".env.example",
            content: `HOST=127.0.0.1\nPORT=3000\nNODE_ENV=development`,
          },
          {
            name: "ci.yml",
            type: "config",
            path: ".github/workflows/ci.yml",
            content: `name: CI\non: [push, pull_request]\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - uses: actions/setup-node@v4\n        with:\n          node-version: 22\n      - run: npm install --no-audit --no-fund\n      - run: npm test\n      - run: npm run build`,
          },
        ],
        decisions: [
          {
            key: "container_base",
            decision: "Alpine Linux",
            rationale: "Minimal attack surface and size",
          },
        ],
        dependencies: ["TASK-006", "TASK-007"],
        risks: [],
        next_actions: [AGENT_ROLES.DOCUMENTATION_ENGINEER],
      },

      [AGENT_ROLES.DOCUMENTATION_ENGINEER]: {
        agent: AGENT_ROLES.DOCUMENTATION_ENGINEER,
        status: "completed",
        task_id: "TASK-009",
        summary: `Documented offline setup, real verification commands, architecture, and starter limitations.`,
        artifacts: [
          {
            name: "README.md",
            type: "doc",
            path: "README.md",
            content: `# ${projectName}\n\nThis is an explicitly simulated HELIX starter, not live-provider generated code. Its Node.js server and browser application can nevertheless be installed, tested, built, and previewed for real.\n\n## Quick Start\nRequires Node.js 22 or newer. No external services or runtime dependencies are required.\n\n\`\`\`sh\nnpm install\nnpm test\nnpm run build\nnpm start\n\`\`\`\n\nOpen http://127.0.0.1:3000. HOST and PORT override the listener. Use npm run dev for the same development server with NODE_ENV=development supplied by HELIX.\n\n## Verification Status\nThe generating agents did not execute commands. A successful npm test, build, or preview is reported separately by HELIX execution jobs.\n\n## Architecture and Limitations\nRefer to docs/architecture.md, docs/api-spec.json, and docs/test-plan.md. This read-only fixture has no authentication, persistence, production hardening, or deployment credentials.`,
          },
        ],
        decisions: [],
        dependencies: ["TASK-008"],
        risks: [],
        next_actions: [],
      },
    };

    const payload = mockBodies[agentRole] || {
      agent: agentRole,
      status: "completed",
      task_id: "TASK-GENERIC",
      summary: `Completed automated engineering assignment for ${agentRole}.`,
      artifacts: [],
      decisions: [],
      dependencies: [],
      risks: [],
      next_actions: [],
    };

    return {
      content: JSON.stringify(payload),
      provider: "mock",
      model: "helix-deterministic-mock",
      tier: ROLE_TO_TIER_MAP[agentRole] || MODEL_TIERS.FAST,
      durationMs: 15,
      usage: { prompt_tokens: 150, completion_tokens: 300, total_tokens: 450 },
    };
  }

  /**
   * Deterministic offline repair draft. Proposes a genuinely minimal, reviewable
   * change for the observed failure when one can be derived statically; otherwise
   * it proposes a failure analysis instead of guessing. The result is always
   * labelled simulated and never claims to have been executed or verified.
   */
  generateMockRepairResponse(agentRole, parsedInput, failure) {
    const selectedFile = parsedInput.context?.selectedFile ?? null;
    const stderrTail = String(failure.stderr ?? failure.stdout ?? "")
      .trim()
      .split("\n")
      .slice(-4)
      .join("\n")
      .slice(0, 800);
    const artifacts = [];
    let summary = `Reviewed the failed command \`${failure.command}\` (exit ${failure.exitCode ?? "n/a"}) and drafted an unverified repair analysis.`;

    // A top-level `throw new Error(<simple literal>)` can be converted into a
    // handled failure report line by line, keeping every other line identical.
    if (selectedFile && /\.(js|mjs|cjs)$/i.test(selectedFile.path)) {
      const throwLine = /^(\s*)throw\s+new\s+Error\s*\(\s*(["'`][^"'`]*["'`])\s*\)\s*;?\s*$/;
      const lines = selectedFile.content.split("\n");
      const matchIndex = lines.findIndex((line) => throwLine.test(line));
      if (matchIndex >= 0) {
        const match = lines[matchIndex].match(throwLine);
        lines[matchIndex] =
          `${match[1]}// Offline repair draft: replaced an unconditional throw with a handled failure report.\n${match[1]}console.error("Handled previously thrown failure:", ${match[2]});`;
        artifacts.push({
          name: selectedFile.path.split("/").pop(),
          type: "file",
          path: selectedFile.path,
          content: lines.join("\n"),
        });
        summary = `Drafted a minimal replacement for ${selectedFile.path} that handles the previously thrown failure instead of crashing. The draft has not been executed.`;
      }
    }

    if (!artifacts.length) {
      artifacts.push({
        name: "repair-analysis.md",
        type: "doc",
        path: "docs/repair-analysis.md",
        content: `# Offline Repair Analysis\n\nDeterministic draft for the failed command \`${failure.command}\` (exit ${failure.exitCode ?? "n/a"}${failure.timedOut ? ", timed out" : ""}).\n\n## Captured failure output\n\n\`\`\`\n${stderrTail || "No stderr captured."}\n\`\`\`\n\n## Next steps\n\n- Read the error location above and inspect the referenced workspace file.\n- A deterministic offline draft cannot safely rewrite this failure class; no file change is proposed.\n- After fixing the file, rerun the same command and let the execution job report the real result.\n`,
      });
    }

    const payload = {
      agent: agentRole,
      status: "completed",
      task_id: "TASK-REPAIR",
      summary,
      artifacts,
      decisions: [
        {
          key: "repair_strategy",
          decision: artifacts[0].path.endsWith(".md")
            ? "analysis-only"
            : "minimal-file-replacement",
          rationale: "Deterministic offline draft derived from the captured failure output",
        },
      ],
      dependencies: [],
      risks: [
        {
          description:
            "Simulated offline draft: the proposal was not executed or verified by HELIX.",
          severity: "medium",
        },
      ],
      next_actions: [],
    };

    return {
      content: JSON.stringify(payload),
      provider: "mock",
      model: "helix-deterministic-mock",
      tier: ROLE_TO_TIER_MAP[agentRole] || MODEL_TIERS.FAST,
      durationMs: 15,
      usage: { prompt_tokens: 150, completion_tokens: 300, total_tokens: 450 },
    };
  }
}
