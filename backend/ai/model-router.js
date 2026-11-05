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
    this.maxRetries = Number(config.aiMaxRetries ?? process.env.AI_MAX_RETRIES ?? 2);
    this.timeoutMs = Number(config.aiTimeoutMs ?? process.env.AI_TIMEOUT_MS ?? 120000);
    this.retryBaseDelayMs = Number(config.aiRetryBaseDelayMs ?? 500);
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

    let modelName = this.config.aiModel || "gemini-2.5-flash";

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
      if (tier === MODEL_TIERS.REASONING) modelName = "grok-3";
      else modelName = "grok-3-mini";
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
      const primaryUrl = this.defaultProvider === "google" ? this.config.aiBaseUrl : "";
      return (primaryUrl || "https://generativelanguage.googleapis.com/v1beta/openai").replace(
        /\/$/,
        "",
      );
    }
    if (provider === "openai") {
      return (this.config.openAiBaseUrl || "https://api.openai.com/v1").replace(/\/$/, "");
    }
    if (provider === "xai") {
      return "https://api.x.ai/v1";
    }
    if (provider === "ollama") {
      return `${this.ollamaBaseUrl}/v1`;
    }
    return "";
  }

  getApiKey(provider) {
    // The generic aiApiKey belongs to the primary provider only; fallbacks use their own keys.
    const primaryKey = (p) => (this.defaultProvider === p ? this.config.aiApiKey : "");
    if (provider === "google")
      return (
        primaryKey("google") || this.config.googleAiApiKey || process.env.GOOGLE_AI_API_KEY || ""
      );
    if (provider === "openai")
      return this.config.openAiApiKey || primaryKey("openai") || process.env.AI_API_KEY || "";
    if (provider === "xai") return this.config.xaiApiKey || process.env.XAI_API_KEY || "";
    if (provider === "ollama") return "ollama-local-key";
    return "";
  }

  /**
   * Invokes a completion with role-based routing, per-provider retries with exponential backoff,
   * timeouts, cancellation (options.signal), optional token streaming (options.onToken), and an
   * explicit fallback provider chain (AI_FALLBACK_PROVIDERS).
   */
  async complete({ agentRole, messages, temperature = 0.2, options = {} }) {
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
        const ollama = await this.tryOllama(agentRole, messages, temperature, options);
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
    return { content, usage };
  }

  emitMock(result, options = {}) {
    if (typeof options.onToken === "function") options.onToken(result.content);
    return result;
  }

  async tryOllama(agentRole, messages, temperature, options = {}) {
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
      signal: options.signal
        ? AbortSignal.any([options.signal, AbortSignal.timeout(this.timeoutMs)])
        : AbortSignal.timeout(this.timeoutMs),
    });
    if (!response.ok) return null;
    const json = await response.json();
    const content = json?.choices?.[0]?.message?.content ?? "";
    if (content) options.onToken?.(content);
    return {
      content,
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
            content: `# Product Requirements Document: ${projectName}\n\n## 1. Executive Summary\n${projectName} is a modern, high-performance platform.\n\n## 2. Target Personas\n- Developers\n- End Users\n\n## 3. User Stories\n- US-1: As a user, I want secure authentication so that my data is protected.\n- US-2: As a user, I want to manage projects so that my work is organized.\n- US-3: As an admin, I want to view system metrics.`,
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
            content: `# System Architecture: ${projectName}\n\n## Architecture Style\nModular Monolith with clean boundary separation.\n\n## Technology Stack\n- Frontend: React / TanStack Router\n- Backend: Node.js HTTP runtime\n- Database: PostgreSQL with memory fallback`,
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
                    post: { responses: { 201: { description: "Create resource" } } },
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
            decision: "PostgreSQL Relational Schema",
            rationale: "ACID compliance",
          },
        ],
        dependencies: ["TASK-001"],
        risks: [{ description: "Database query bottlenecks on high volume", severity: "low" }],
        next_actions: [AGENT_ROLES.DATABASE_ENGINEER, AGENT_ROLES.FRONTEND_ENGINEER],
      },

      [AGENT_ROLES.DATABASE_ENGINEER]: {
        agent: AGENT_ROLES.DATABASE_ENGINEER,
        status: "completed",
        task_id: "TASK-003",
        summary: `Authored PostgreSQL relational schema and migration scripts with foreign keys and indexes.`,
        artifacts: [
          {
            name: "schema.sql",
            type: "sql",
            path: "database/schema.sql",
            content: `CREATE TABLE IF NOT EXISTS users (\n  id VARCHAR(64) PRIMARY KEY,\n  email VARCHAR(255) UNIQUE NOT NULL,\n  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()\n);\n\nCREATE TABLE IF NOT EXISTS items (\n  id VARCHAR(64) PRIMARY KEY,\n  user_id VARCHAR(64) REFERENCES users(id) ON DELETE CASCADE,\n  title VARCHAR(255) NOT NULL,\n  status VARCHAR(32) DEFAULT 'active',\n  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()\n);\n\nCREATE INDEX IF NOT EXISTS idx_items_user_id ON items(user_id);`,
          },
        ],
        decisions: [
          {
            key: "id_strategy",
            decision: "UUID / Prefixed String",
            rationale: "Safe client-side generation",
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
            name: "routes.js",
            type: "code",
            path: "src/api/routes.js",
            content: `export function registerResourceRoutes(app) {\n  app.get('/api/v1/resources', async (req, res) => {\n    return res.json({ items: [] });\n  });\n}`,
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
        summary: `Implemented React UI views, responsive navigation, and client query integration.`,
        artifacts: [
          {
            name: "ResourceList.tsx",
            type: "code",
            path: "src/components/ResourceList.tsx",
            content: `import React from 'react';\n\nexport function ResourceList() {\n  return (\n    <div className="p-4 border rounded-lg">\n      <h2 className="text-xl font-bold">Project Workspace</h2>\n      <p className="text-sm text-gray-500">Live resources loaded dynamically.</p>\n    </div>\n  );\n}`,
          },
        ],
        decisions: [
          {
            key: "ui_toolkit",
            decision: "Tailwind CSS & Radix UI",
            rationale: "Accessible and responsive",
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
        summary: `Conducted OWASP Top 10 threat modeling and dependency audit. Security score: 95/100.`,
        artifacts: [
          {
            name: "security-audit.md",
            type: "spec",
            path: "docs/security-audit.md",
            content: `# Security Audit Report\n\n- Authentication: Token-based with rate-limiting verified.\n- SQL Injection: Parameterized queries enforced.\n- CORS & Headers: Strict policy recommended.\n- Score: 95/100`,
          },
        ],
        decisions: [
          {
            key: "rate_limiting",
            decision: "Sliding window limiter",
            rationale: "Prevent brute-force abuse",
          },
        ],
        dependencies: ["TASK-004"],
        risks: [
          { description: "Enforce strict CORS headers in production deployment", severity: "low" },
        ],
        next_actions: [AGENT_ROLES.DEVOPS_ENGINEER],
      },

      [AGENT_ROLES.QA_ENGINEER]: {
        agent: AGENT_ROLES.QA_ENGINEER,
        status: "completed",
        task_id: "TASK-007",
        summary: `Executed verification test plan against PRD user stories. 100% acceptance criteria passed.`,
        artifacts: [
          {
            name: "test-plan.md",
            type: "spec",
            path: "docs/test-plan.md",
            content: `# QA Test Report\n\n- TC-01: Health check endpoint verification — PASSED\n- TC-02: Resource listing pagination — PASSED\n- TC-03: Input validation bounds — PASSED\n\nRelease Candidate Status: PASS`,
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
        summary: `Created production multi-stage Dockerfile and GitHub Actions CI/CD workflows.`,
        artifacts: [
          {
            name: "Dockerfile",
            type: "config",
            path: "Dockerfile",
            content: `FROM node:22-alpine AS builder\nWORKDIR /app\nCOPY package*.json ./\nRUN npm ci\nCOPY . .\nRUN npm run build\n\nFROM node:22-alpine\nWORKDIR /app\nCOPY --from=builder /app ./\nEXPOSE 3001\nCMD ["node", "backend/index.js"]`,
          },
          {
            name: "ci.yml",
            type: "config",
            path: ".github/workflows/ci.yml",
            content: `name: CI\non: [push, pull_request]\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - uses: actions/setup-node@v4\n      - run: npm ci\n      - run: npm test`,
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
        summary: `Compiled production-ready README.md, API documentation, and architecture runbooks.`,
        artifacts: [
          {
            name: "README.md",
            type: "doc",
            path: "README.md",
            content: `# ${projectName}\n\nEngineered by the HELIX AI Engineering Operating System.\n\n## Quick Start\n\`\`\`sh\nnpm install\nnpm run dev\n\`\`\`\n\n## Architecture\nRefer to \`docs/architecture.md\` and \`docs/api-spec.json\`.`,
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
}
