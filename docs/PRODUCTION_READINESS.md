# HELIX — Production Readiness Notes

## 1. Completed (verified by automated tests)

| Area | Change |
| --- | --- |
| Persistence | Workflows, agent workspaces/artifacts and traces are persisted with users/projects in the JSON store (`HELIX_STORAGE_PATH`) using atomic temp-file + rename writes and coalesced flushes. State survives restarts; workflows interrupted mid-run are re-queued and resumed on boot. |
| Orchestration | Single-flight execution per workflow; agent failure sets the workflow to `failed` (previously stuck on `running`); `retry` re-runs only failed/cancelled tasks; `cancel` aborts in-flight model calls; checkpoint decisions support approve / request revision (re-runs the gated agent with reviewer comments) / reject; checkpoint type is validated; duplicate active workflows are rejected; progress and status are mirrored onto the project. |
| Agent execution | Task metadata records provider, model, token usage, attempts, duration and whether output was simulated. Schema-repair retries only for validation errors (transport errors are retried by the router). |
| Provider routing | Per-provider retries with exponential backoff (honours `Retry-After`), request timeouts, caller cancellation, explicit fallback chain (`AI_FALLBACK_PROVIDERS`). A configured provider that fails now surfaces an error instead of silently returning mock output. Mock output is used only when no provider is configured and it is allowed, and is labelled `Simulated output` in the UI. |
| Streaming | The Node HTTP adapter now streams response bodies (SSE previously never reached clients because the body was buffered). SSE is scoped to the requesting user's project, sends an initial `office_snapshot`, and forwards `task_stream` token deltas. The Office UI uses SSE with a polling fallback. |
| Security | Ownership checks on workflow approve/traces/retry/cancel (404 for foreign IDs) and the SSE stream; salted scrypt password hashes with transparent upgrade of legacy SHA-256 hashes; logout, `/auth/me`, change-password; password reset persists and revokes sessions; OAuth no longer fabricates demo accounts or assigns a shared password, Google uses PKCE + state; production refuses the default `JWT_SECRET`; CORS allow-list; `nosniff`/`DENY`/`no-referrer` headers; request body limit; malformed JSON → 400. |
| Frontend | Removed static Billing, Integrations and Maintenance pages and the hardcoded data module. Security and Deployments render real Security/DevOps agent output. Settings edits the project brief, profile and password and shows backend runtime config. The sidebar shows the signed-in user with logout. All TypeScript errors fixed. |
| Workspace files | Authenticated create/read/save/delete APIs per project with ownership checks, version conflict detection (409 on stale writes), path-traversal and symlink containment, a 2 MiB per-file UTF-8 limit, a 50 MiB / 2,000-file workspace cap, and on-disk deletion. The workspace UI (editor, file explorer, terminal, preview, lifecycle) is wired to these APIs from navigation and project cards. |
| Sandboxed execution | Real command execution per project through Bubblewrap (`--unshare-all`, read-only host binds, no network by default) plus `/usr/bin/prlimit` (4 GiB address-space cap; Node heap capped at 512 MiB). Only `node`, `npm`, `npx`, and `python3` executables are allowed; commands are tokenized argv (no shell). Availability is probed and reported; jobs report true exit codes, stdout/stderr, timeouts, cancellation, and output truncation. Cumulative output is capped at 1 MiB (process killed), 25 active jobs per project, 100 retained per project. Install and preview jobs may enable network; ordinary commands, tests, and builds run network-isolated. |
| Execution events | Asynchronous job APIs (`execute`, `install`, `test`, `build`, terminal, list/get/stop) and an SSE stream carrying snapshots, status changes, streamed output chunks, completion, and preview lifecycle events. |
| Application lifecycle & preview | Install/test/build lifecycle built on the sandbox with persisted artifacts (e.g. a real `package-lock.json`). Live preview starts the project's real server (or serves an `index.html` workspace) on an allocated loopback port — caller-selected ports are rejected to prevent SSRF — behind a project-scoped 32-byte token URL. The proxy rewrites HTML with a `<base>` and a fetch/XHR mapper so relative assets and root-relative API calls stay authenticated; preview responses use CSP `frame-ancestors` (from the CORS origin list) instead of `X-Frame-Options`, since the frontend and API origins differ. |
| AI repair | Repair requests require a real completed (failed) execution job; the provider receives the command, exit code, and output tail plus the selected file and proposes complete replacement files. Proposals are labelled `simulated` in mock mode and are never applied automatically — the user reviews and explicitly applies each file, then reruns the command. The deterministic offline draft converts an observed top-level `throw new Error(...)` into a handled failure report (verified end to end: failed job → proposal → apply → rerun exit 0) and otherwise proposes an analysis document instead of guessing. |
| TASKFLOW & GitHub export | TASKFLOW persists a dependency graph of sandbox-backed commands; reruns reset every task so tasks blocked by an earlier failure complete after a repair. GitHub export uses the Git Data API (tested against a local contract server; no live GitHub claim). |

## 2. Outstanding issues

- **PostgreSQL is not implemented.** `DATABASE_URL` is recorded but persistence uses the single-process JSON file store, which does not support horizontal scaling. `database.js` now reports `postgres-not-implemented`.
- **Single instance only.** Rate limiters, the SSE event bus, run locks, execution jobs, and live previews are in-process. Multi-instance deployment requires shared job/preview state and per-host workspace volumes.
- **Preview processes are in-memory.** Active previews and their tokens do not survive an API restart; users start them again from the workspace. Token revocation on project delete happens in memory only.
- **Sandbox scope.** Bubblewrap isolation (pid/net/ipc/uts/user/cgroup namespaces, read-only host) is strong but unhardened: it is not a seccomp-guaranteed boundary and depends on a correct host mount table. Prefer dedicated nodes or VMs for untrusted work; keep `HELIX_WORKSPACE_ROOT` off the API's system volume.
- **Session tokens in `localStorage`** and passed as a query parameter for EventSource; consider httpOnly cookies. Preview authorization is a secret URL token rather than a session cookie by design (iframes need it), so preview URLs must be treated as secrets.
- **Repo-wide Prettier errors** remain across the codebase, including files not touched by this work (`npm run lint`: formatting only); run `npm run format` in a dedicated PR.
- Frontend has no automated component tests; the workspace flow (login → project → nine agents → files → terminal → install/test/build → live preview with a real API round trip → AI repair apply/rerun) was verified manually in a real browser against the running stack.
- Live Gemini/OpenAI/xAI/SMTP/OAuth and production database credentials are unavailable in this environment; provider transports are implemented but only the deterministic mock and local contract servers are exercised by tests.

## 3. Test results

- `npm test`: 73 passed, 0 failed — including the real sandboxed workspace lifecycle (file APIs, terminal execution, install/test/build, live preview proxy with authorization and framing headers), the labelled mock repair loop (failed job → proposal → apply → rerun exit 0), the nine coherent mock agents, TASKFLOW reset semantics, and the GitHub export contract against a local Git Data API server.
- `npm run typecheck`: 0 errors.
- `npm run build`: passes.
- `npm audit --omit=dev`: 0 vulnerabilities.
- `npm run lint`: 1067 pre-existing formatting errors (Prettier only) across the repo; no new rule violations were introduced.

## 4. Deployment requirements

- Node.js 22+.
- Linux host with `bubblewrap` (`bwrap`) on PATH and `/usr/bin/prlimit` for sandboxed execution; execution and preview degrade to a clear unavailable status without them.
- `NODE_ENV=production`, a strong random `JWT_SECRET`, `BASE_URL`, `CORS_ORIGINS` (also scopes preview `frame-ancestors`).
- `HELIX_STORAGE_PATH` and `HELIX_WORKSPACE_ROOT` on persistent volumes (single replica); workspace disks are per-project and can be deleted.
- Install and preview jobs need outbound network access (package registries); ordinary commands, tests, and builds run with networking disabled inside the sandbox — ensure host egress policy matches this split.
- At least one AI provider key (`GOOGLE_AI_API_KEY`, `AI_API_KEY` for OpenAI or `XAI_API_KEY`), optionally `AI_FALLBACK_PROVIDERS`. Keep `HELIX_ALLOW_MOCK_FALLBACK=false` in production.
- Email: `EMAIL_PROVIDER=smtp|sendgrid` with credentials (the `demo` provider exposes tokens in responses outside production only).
- OAuth (optional): `GOOGLE_CLIENT_ID/SECRET`, `GITHUB_CLIENT_ID/SECRET` and matching `VITE_*` client IDs.
- Reverse proxy must not buffer `text/event-stream` (the API sends `X-Accel-Buffering: no`) and must preserve the preview path prefix (`/api/v1/projects/:id/preview/:token/...`).
- Start the API with `npm run start:api`; build the frontend with `npm run build`.
