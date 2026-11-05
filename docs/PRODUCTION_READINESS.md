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

## 2. Outstanding issues

- **PostgreSQL is not implemented.** `DATABASE_URL` is recorded but persistence uses the single-process JSON file store, which does not support horizontal scaling. `database.js` now reports `postgres-not-implemented`.
- **Single instance only.** Rate limiters, the SSE event bus and run locks are in-process.
- **Session tokens in `localStorage`** and passed as a query parameter for EventSource; consider httpOnly cookies.
- **Repo-wide Prettier errors** remain in files not touched by this work (`npm run lint`: formatting only); run `npm run format` in a dedicated PR.
- Agent artifacts are generated specifications/code stored in a virtual workspace; they are not compiled, executed or deployed.
- Frontend has no automated component tests and has not yet been browser-tested end to end; backend SSE was verified against a real HTTP server.

## 3. Test results

- `npm test`: 54 passed, 0 failed (27 pre-existing + 27 new).
- `npm run typecheck`: 0 errors (previously 13).
- `npm run build`: passes.
- `npm ci`: works with the updated lockfile (previously failed: lockfile out of sync).

## 4. Deployment requirements

- Node.js 22+.
- `NODE_ENV=production`, a strong random `JWT_SECRET`, `BASE_URL`, `CORS_ORIGINS`.
- `HELIX_STORAGE_PATH` on a persistent volume (single replica).
- At least one AI provider key (`GOOGLE_AI_API_KEY`, `AI_API_KEY` for OpenAI or `XAI_API_KEY`), optionally `AI_FALLBACK_PROVIDERS`. Keep `HELIX_ALLOW_MOCK_FALLBACK=false` in production.
- Email: `EMAIL_PROVIDER=smtp|sendgrid` with credentials (the `demo` provider exposes tokens in responses outside production only).
- OAuth (optional): `GOOGLE_CLIENT_ID/SECRET`, `GITHUB_CLIENT_ID/SECRET` and matching `VITE_*` client IDs.
- Reverse proxy must not buffer `text/event-stream` (the API sends `X-Accel-Buffering: no`).
- Start the API with `npm run start:api`; build the frontend with `npm run build`.
