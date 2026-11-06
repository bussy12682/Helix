import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AppShell } from "@/components/helix/app-shell";

/**
 * Boot-probe behavior of the app shell:
 *  - a stored credential triggers GET /api/v1/auth/me and renders the user;
 *  - an invalid/expired session (401) logs out server-side and redirects to /login;
 *  - bearer mode without a stored token performs no probe at all.
 *
 * A minimal in-memory TanStack router is built per test (the shell's nav links need
 * their routes registered; every target gets a stub).
 */

const USER_RESPONSE = {
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

const NAV_STUB_PATHS = [
  "/dashboard",
  "/projects",
  "/projects/workspace",
  "/office",
  "/office/tasks",
  "/deployments",
  "/security",
  "/settings",
] as const;

function renderInRouter(element: React.ReactElement) {
  const rootRoute = createRootRoute();
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: () => element,
  });
  const loginRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/login",
    component: () => <div data-testid="login-page">Login Page</div>,
  });
  const stubs = NAV_STUB_PATHS.map((path) =>
    createRoute({
      getParentRoute: () => rootRoute,
      path,
      component: () => <div data-testid={`stub-${path.replace(/\//g, "-")}`}>{path}</div>,
    }),
  );
  const router = createRouter({
    routeTree: rootRoute.addChildren([indexRoute, loginRoute, ...stubs]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  render(<RouterProvider router={router} />);
  return router;
}

function mockFetchResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("AppShell boot probe", () => {
  it("renders the signed-in user after probing /api/v1/auth/me", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/v1/auth/me")) return mockFetchResponse(USER_RESPONSE);
      return mockFetchResponse({});
    });
    vi.stubGlobal("fetch", fetchMock);
    window.localStorage.setItem("helix_session", JSON.stringify({ token: "tok_session" }));

    renderInRouter(
      <AppShell title="Test Shell">
        <div>shell content</div>
      </AppShell>,
    );

    expect(await screen.findByText("Ada Lovelace")).toBeInTheDocument();
    expect(await screen.findByText("ada@example.com")).toBeInTheDocument();
    const meCalls = fetchMock.mock.calls.filter((call) => String(call[0]).includes("/auth/me"));
    expect(meCalls).toHaveLength(1);
  });

  it("logs out server-side and redirects to /login when the session is invalid", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/v1/auth/me")) {
        return mockFetchResponse({ error: { code: "UNAUTHORIZED", message: "no" } }, 401);
      }
      if (url.includes("/api/v1/auth/logout") && init?.method === "POST") {
        return mockFetchResponse({ message: "Logged out" });
      }
      return mockFetchResponse({});
    });
    vi.stubGlobal("fetch", fetchMock);
    window.localStorage.setItem("helix_session", JSON.stringify({ token: "tok_expired" }));

    renderInRouter(
      <AppShell title="Test Shell">
        <div>shell content</div>
      </AppShell>,
    );

    expect(await screen.findByTestId("login-page")).toBeInTheDocument();
    // The invalid session was revoked server-side, not just dropped client-side.
    const logoutCalls = fetchMock.mock.calls.filter((call) =>
      String(call[0]).includes("/api/v1/auth/logout"),
    );
    expect(logoutCalls).toHaveLength(1);
    expect(window.localStorage.getItem("helix_session")).toBeNull();
  });

  it("performs no probe in bearer mode when no credential is stored", async () => {
    const fetchMock = vi.fn(async () => mockFetchResponse({}));
    vi.stubGlobal("fetch", fetchMock);

    renderInRouter(
      <AppShell title="Test Shell">
        <div>shell content</div>
      </AppShell>,
    );

    // The shell stays in its unauthenticated state; no /auth/me round-trip happens.
    expect(await screen.findByText("Loading…")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
