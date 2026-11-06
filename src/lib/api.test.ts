import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Session transport tests: bearer mode (localStorage + Authorization header) and
 * cookie-session mode (no client-side token, credentials: "include", httpOnly cookie).
 *
 * The api module captures COOKIE_SESSIONS at import time, so each mode gets a fresh
 * module instance via vi.resetModules() + vi.stubEnv().
 */

type ApiModule = typeof import("@/lib/api");

const BEARER_RESPONSE = {
  user: {
    id: "u1",
    name: "Ada Lovelace",
    email: "ada@example.com",
    emailVerified: true,
    authProvider: "local",
    createdAt: "2026-01-01T00:00:00.000Z",
  },
  session: { expiresAt: "2026-01-02T00:00:00.000Z", rememberMe: false },
};

class MockEventSource {
  static instances: Array<{ url: string; options: EventSourceInit | undefined }> = [];
  url: string;
  options: EventSourceInit | undefined;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;

  constructor(url: string, options?: EventSourceInit) {
    this.url = url;
    this.options = options;
    MockEventSource.instances.push({ url, options });
  }

  close() {
    /* captured by tests via instances */
  }
}

function mockFetchResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

async function importApi(cookieMode: boolean): Promise<ApiModule> {
  vi.resetModules();
  vi.stubEnv("VITE_COOKIE_SESSIONS", cookieMode ? "true" : "");
  return (await import("@/lib/api")) as ApiModule;
}

function lastCall(fetchMock: ReturnType<typeof vi.fn>) {
  const call = fetchMock.mock.calls.at(-1);
  return { url: String(call?.[0]), init: (call?.[1] ?? {}) as RequestInit };
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  MockEventSource.instances = [];
  vi.stubGlobal("EventSource", MockEventSource as unknown as typeof EventSource);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("bearer session mode (default)", () => {
  it("persists the session token in localStorage", async () => {
    const api = await importApi(false);
    expect(api.COOKIE_SESSIONS).toBe(false);

    api.setStoredSessionToken("tok_bearer");
    expect(api.getStoredSessionToken()).toBe("tok_bearer");
    expect(window.localStorage.getItem("helix_session")).toBe(
      JSON.stringify({ token: "tok_bearer" }),
    );

    api.setStoredSessionToken(null);
    expect(api.getStoredSessionToken()).toBeNull();
    expect(window.localStorage.getItem("helix_session")).toBeNull();
  });

  it("sends the Authorization header and same-origin credentials", async () => {
    const api = await importApi(false);
    const fetchMock = vi.fn(async () => mockFetchResponse(BEARER_RESPONSE));
    vi.stubGlobal("fetch", fetchMock);

    const result = await api.getCurrentUser("tok_bearer");
    expect(result.user.email).toBe("ada@example.com");

    const { url, init } = lastCall(fetchMock);
    expect(url).toBe("http://localhost:3001/api/v1/auth/me");
    expect(init.credentials).toBe("same-origin");
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer tok_bearer");
  });

  it("authHeaders omits the header when no token is available", async () => {
    const api = await importApi(false);
    expect(api.authHeaders(null)).toEqual({});
    expect(api.authHeaders(undefined)).toEqual({});
    expect(api.authHeaders("tok")).toEqual({ Authorization: "Bearer tok" });
  });

  it("authenticates the SSE stream with a token query parameter", async () => {
    const api = await importApi(false);
    const unsubscribe = api.subscribeToProjectEvents("p1", "tok_bearer", {
      onEvent: () => {},
      onStatus: () => {},
    });

    const instance = MockEventSource.instances.at(-1);
    expect(instance?.url).toBe(
      "http://localhost:3001/api/v1/projects/p1/workflows/stream?token=tok_bearer",
    );
    expect(instance?.options).toBeUndefined();
    unsubscribe();
  });

  it("logout calls the endpoint with the bearer token and clears storage", async () => {
    const api = await importApi(false);
    api.setStoredSessionToken("tok_bearer");
    const fetchMock = vi.fn(async () => mockFetchResponse({ message: "Logged out" }));
    vi.stubGlobal("fetch", fetchMock);

    await api.logout();
    const { url, init } = lastCall(fetchMock);
    expect(url).toBe("http://localhost:3001/api/v1/auth/logout");
    expect(init.method).toBe("POST");
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer tok_bearer");
    expect(api.getStoredSessionToken()).toBeNull();
  });

  it("skips the logout request entirely when no session exists", async () => {
    const api = await importApi(false);
    const fetchMock = vi.fn(async () => mockFetchResponse({}));
    vi.stubGlobal("fetch", fetchMock);

    await api.logout();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("maps error responses to ApiRequestError with the server code", async () => {
    const api = await importApi(false);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        mockFetchResponse({ error: { code: "SESSION_EXPIRED", message: "expired" } }, 401),
      ),
    );

    await expect(api.getCurrentUser("tok_bearer")).rejects.toMatchObject({
      name: "ApiRequestError",
      code: "SESSION_EXPIRED",
      message: "expired",
    });
  });
});

describe("cookie session mode (VITE_COOKIE_SESSIONS=true)", () => {
  it("never writes a token to localStorage and returns only an opaque marker", async () => {
    const api = await importApi(true);
    expect(api.COOKIE_SESSIONS).toBe(true);

    // Simulate a legacy token from an earlier bearer-mode deployment.
    window.localStorage.setItem("helix_session", JSON.stringify({ token: "stale_legacy" }));

    api.setStoredSessionToken("real_token_from_login_response");
    expect(window.localStorage.getItem("helix_session")).toBeNull();

    const credential = api.getStoredSessionToken();
    expect(typeof credential).toBe("string");
    expect(credential).toBeTruthy();
    // The marker is never the real token — the page cannot learn it.
    expect(credential).not.toBe("real_token_from_login_response");
    expect(credential).not.toBe("stale_legacy");

    api.setStoredSessionToken(null);
    // The cookie remains the credential after reload; the marker persists.
    expect(api.getStoredSessionToken()).toBeTruthy();
  });

  it("authenticates requests with cookies instead of an Authorization header", async () => {
    const api = await importApi(true);
    const fetchMock = vi.fn(async (_input?: RequestInfo | URL, _init?: RequestInit) =>
      mockFetchResponse(BEARER_RESPONSE),
    );
    vi.stubGlobal("fetch", fetchMock);

    // No token at all (page reload) and the opaque marker must behave identically.
    await api.getCurrentUser();
    await api.getCurrentUser(api.getStoredSessionToken());

    for (const call of fetchMock.mock.calls) {
      const init = (call[1] ?? {}) as RequestInit;
      expect(init.credentials).toBe("include");
      expect(new Headers(init.headers).get("authorization")).toBeNull();
    }
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("authHeaders never emits an Authorization header in cookie mode", async () => {
    const api = await importApi(true);
    expect(api.authHeaders("anything")).toEqual({});
    expect(api.authHeaders(api.getStoredSessionToken())).toEqual({});
  });

  it("still calls logout so the server clears the httpOnly cookie", async () => {
    const api = await importApi(true);
    const fetchMock = vi.fn(async () => mockFetchResponse({ message: "Logged out" }));
    vi.stubGlobal("fetch", fetchMock);

    await api.logout();
    const { url, init } = lastCall(fetchMock);
    expect(url).toBe("http://localhost:3001/api/v1/auth/logout");
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("include");
    expect(new Headers(init.headers).get("authorization")).toBeNull();
  });

  it("subscribes to SSE with withCredentials and no token in the URL", async () => {
    const api = await importApi(true);
    const unsubscribeWorkflow = api.subscribeToProjectEvents(
      "p1",
      api.getStoredSessionToken() ?? "",
      {
        onEvent: () => {},
        onStatus: () => {},
      },
    );
    const unsubscribeExecutions = api.subscribeToExecutionEvents(
      "p1",
      api.getStoredSessionToken() ?? "",
      { onEvent: () => {}, onStatus: () => {} },
    );

    for (const instance of MockEventSource.instances) {
      expect(instance.url.includes("token=")).toBe(false);
      expect(instance.options?.withCredentials).toBe(true);
    }
    expect(MockEventSource.instances).toHaveLength(2);
    unsubscribeWorkflow();
    unsubscribeExecutions();
  });
});

describe("health endpoint typing", () => {
  it("parses the extended health payload including readiness", async () => {
    const api = await importApi(false);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        mockFetchResponse({
          ok: true,
          service: "helix-core",
          status: "healthy",
          environment: "test",
          storage: "memory",
          ai: {
            mode: "mock",
            primaryProvider: "google",
            fallbackProviders: [],
            configuredProviders: [],
            mockFallbackAllowed: true,
          },
          readiness: {
            storage: { mode: "memory" },
            execution: { available: true, active: 0, trackedJobs: 0, maxConcurrent: 2 },
            providers: null,
            recovery: {
              hydratedExecutionJobs: 0,
              interruptedExecutionJobs: 0,
              hydratedPipelineRuns: 0,
              interruptedPipelineRuns: 0,
              recoveredAt: "2026-01-01T00:00:00.000Z",
            },
          },
          uptimeSeconds: 5,
          timestamp: "2026-01-01T00:00:00.000Z",
        }),
      ),
    );

    const health = await api.getSystemHealth();
    expect(health.status).toBe("healthy");
    expect(health.storage).toBe("memory");
    expect(health.readiness?.execution.available).toBe(true);
    expect(health.readiness?.recovery?.recoveredAt).toBe("2026-01-01T00:00:00.000Z");
  });
});
