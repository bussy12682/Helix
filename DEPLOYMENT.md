# HELIX — Deployment Guide

This guide covers a production deployment of the HELIX API and frontend:
requirements, configuration, PostgreSQL setup, day-2 operations (monitoring,
backups, budgets/audit), and the pre-launch checklist.

For the security model see `docs/SECURITY.md`; for current status and known
limitations see `docs/PRODUCTION_READINESS.md`.

## 1. Architecture at a glance

- **API** (`backend/index.js`): Node.js 22+, no framework runtime beyond the
  standard library. Serves the REST API, SSE streams, and the sandboxed
  execution/preview proxy. Listens on `APP_PORT` (default 3001) only after
  migrations, state hydration, and boot recovery complete (`app.ready`).
- **Frontend** (`src/`): TanStack Start app built with `npm run build`
  (server-rendered entry via `src/server.ts`, static deployable output).
- **State**: PostgreSQL (recommended, `DATABASE_URL`) or — for single-node,
  non-critical deployments — the JSON file store (`HELIX_STORAGE_PATH`).
- **Workspaces**: each project's files live under `HELIX_WORKSPACE_ROOT` and
  are executed inside a bubblewrap sandbox on the same host.

**Scaling: one API replica per database.** The instance takes a PostgreSQL
advisory lock at boot and a second instance against the same database refuses
to start. Rate limiters, the SSE event bus, execution jobs, and previews are
in-process. Horizontal scaling requires shared job/preview state and per-host
workspace volumes (not implemented — see PRODUCTION_READINESS).

## 2. Host requirements

| Requirement                                | Why                                                                                                 | Without it                                                                 |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Linux, `bwrap` on PATH, `/usr/bin/prlimit` | Sandboxed command execution                                                                         | Execution/preview report `unavailable` honestly; the rest of the API works |
| Outbound network from the API host         | `npm install` for project builds; AI provider calls; SMTP                                           | Installs and provider calls fail                                           |
| PostgreSQL 13+ (recommended)               | Durable state (`WITH (FORCE)` drop support used by tests; production needs 13+ for everything else) | JSON file store fallback                                                   |
| Node.js 22+                                | Runtime                                                                                             | —                                                                          |

## 3. Configuration

Copy `.env.example` to `.env.local` and fill in. The essential production set:

```sh
NODE_ENV=production
APP_PORT=3001
BASE_URL=https://helix.example.com
CORS_ORIGINS=https://helix.example.com           # comma-separated; also scopes preview frame-ancestors
JWT_SECRET=<64+ random hex chars>                 # startup REFUSES the default in production
DATABASE_URL=postgres://helix:pass@db-host:5432/helix

# AI providers (at least one) — verify with: npm run verify:providers
AI_PROVIDER=google                                # google | openai | xai
GOOGLE_AI_API_KEY=...                             # AI_API_KEY for OpenAI, XAI_API_KEY for xAI
AI_FALLBACK_PROVIDERS=                            # optional ordered fallbacks
HELIX_ALLOW_MOCK_FALLBACK=false                   # keep simulated output out of production

# Email
EMAIL_PROVIDER=smtp                               # demo | smtp | sendgrid
```

### Operational controls

| Variable                            | Default   | Meaning                                                                                                                                                                                                       |
| ----------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `HELIX_LOG_LEVEL`                   | `info`    | `debug`/`info`/`warn`/`error`; logs are JSON lines with secrets redacted                                                                                                                                      |
| `HELIX_USER_DAILY_TOKEN_LIMIT`      | `2000000` | Daily AI token budget per user (0 = unlimited)                                                                                                                                                                |
| `HELIX_PROJECT_DAILY_TOKEN_LIMIT`   | `4000000` | Daily AI token budget per project (0 = unlimited)                                                                                                                                                             |
| `HELIX_AI_RATE_LIMIT_MAX`           | `40`      | AI-route requests per window per user (429 beyond)                                                                                                                                                            |
| `HELIX_AI_RATE_LIMIT_WINDOW_MS`     | `900000`  | Window length for the AI route limit (15 min)                                                                                                                                                                 |
| `HELIX_MAX_ACTIVE_JOBS_PER_PROJECT` | `25`      | Concurrent in-flight sandbox jobs per project                                                                                                                                                                 |
| `EXECUTION_MAX_CONCURRENT`          | `2`       | Global concurrent sandbox jobs (1–8)                                                                                                                                                                          |
| `HELIX_AUTONOMOUS_AUTO_APPROVE`     | unset     | Autonomous runs auto-approve human gates. **In production the start is rejected with 403 `AUTONOMOUS_APPROVAL_REQUIRED` unless this is explicitly `true`.** Opt in only for trusted, rate-limited user bases. |

### Sessions and previews

| Variable                | Default         | Meaning                                                                                                                                                     |
| ----------------------- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `HELIX_COOKIE_SESSIONS` | unset (`false`) | Issue `helix_session` httpOnly cookie (SameSite=Lax, Secure in production) alongside the bearer token. Requires the frontend build flag below to be useful. |
| `HELIX_PREVIEW_TTL_MS`  | `86400000`      | Preview capability lifetime; expired previews stop their job and reject their token                                                                         |

Frontend build-time flags (set when running `npm run build`):

| Variable                    | Meaning                                                                                                                                                        |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `VITE_API_BASE_URL`         | API origin (default `http://localhost:3001`)                                                                                                                   |
| `VITE_COOKIE_SESSIONS=true` | Frontend cookie-session mode: no token in localStorage, requests use `credentials: "include"` and the httpOnly cookie. Pair with `HELIX_COOKIE_SESSIONS=true`. |

## 4. Database setup

1. Create the database and user (any PostgreSQL 13+; 15 recommended):

   ```sql
   CREATE ROLE helix LOGIN PASSWORD '...';
   CREATE DATABASE helix OWNER helix;
   ```

   No further privileges are needed — HELIX owns its schema.

2. Set `DATABASE_URL=postgres://helix:...@host:5432/helix` and start the API.
   Migrations (`backend/migrations/*.sql`) are applied transactionally under an
   advisory lock on boot, state is hydrated, and mid-flight work from a crashed
   previous process is finalized as `interrupted` — **before** the listener
   opens. A failed boot refuses to serve traffic.

3. Verify with `curl -s $BASE_URL/api/v1/health | jq`. `readiness.storage.mode`
   must be `postgres` and `status` must be `healthy` (or `degraded` with a
   surfaced write error, which must be investigated).

Migrations are append-only files; never edit an applied migration — add a new
`NNN_*.sql`. Migration state is tracked in the `schema_migrations` table.

## 5. Build and run

```sh
npm ci
npm run build                 # frontend production build
npm run start:api             # backend (loads .env.local / .env)
```

Sanity checks before opening traffic:

```sh
curl -s $BASE_URL/api/v1/health | jq '{status, storage, readiness}'
npm run verify:providers      # real completion call per configured provider
npm test                      # backend suite (needs no external services)
npm run test:ui               # frontend suite
```

Reverse proxy notes: do not buffer `text/event-stream` (the API sends
`X-Accel-Buffering: no`); preserve the preview path prefix
(`/api/v1/projects/:id/preview/:token/...`); terminate TLS at the proxy (cookie
`Secure` and OAuth redirects assume HTTPS).

## 6. Monitoring

- **`GET /api/v1/health`** returns: overall `status` (`healthy`/`degraded`),
  `readiness.storage` (mode, pending writes, last write error), sandbox
  `readiness.execution` (availability, active jobs, concurrency), provider
  configuration (`readiness.providers`), and the boot `recovery` summary
  (hydrated/interrupted job and pipeline-run counts). Alert on
  `status != healthy` and on `readiness.execution.available == false`.
- **Logs** are JSON lines (`{time, level, component, msg, ...}`) on stdout with
  automatic redaction of token/password/key-like values. Ship them to your
  aggregator as-is; `HELIX_LOG_LEVEL=info` is the production default.
- **Spend**: `GET /api/v1/usage` (self-service, per user/project daily token
  usage and configured limits). Budget-exhausted requests return audited 429s.
- **Audit**: `GET /api/v1/audit` (self-service, per user; bounded redacted
  trail of auth/project/execution/approval/governance events). The full audit
  table lives in PostgreSQL (`audit_events`).

## 7. Backups and recovery

- **PostgreSQL**: nightly `pg_dump` minimum; point-in-time recovery recommended.
  This covers users, sessions, projects, workflows, workspaces, taskflows,
  execution-job and pipeline-run records, budget usage, and audit events.
- **Workspace volumes** (`HELIX_WORKSPACE_ROOT`): per-project files. Back up or
  accept regeneration from workspace snapshots stored in the database — job
  history and run summaries are safe either way.
- **Crash recovery**: restart the process. On boot, mid-flight execution jobs
  and autonomous runs are finalized as `interrupted` (never resurrected);
  interrupted workflows are re-queued. Users re-run what was in flight.

## 8. Pre-launch checklist

- [ ] `NODE_ENV=production`, strong `JWT_SECRET`, `CORS_ORIGINS` set to the real origins
- [ ] `DATABASE_URL` set; health shows `storage.mode=postgres`, `status=healthy`
- [ ] `npm run verify:providers` passes for every provider in the chain
- [ ] `HELIX_ALLOW_MOCK_FALLBACK=false`; mock output cannot reach users
- [ ] Decide the autonomous-approval posture: leave `HELIX_AUTONOMOUS_AUTO_APPROVE` unset (403 in production) or document the opt-in
- [ ] Budgets and AI rate limits sized for your user base
- [ ] Cookie sessions: enable `HELIX_COOKIE_SESSIONS` + `VITE_COOKIE_SESSIONS` together or neither
- [ ] `EMAIL_PROVIDER` != `demo`; demo login disabled (`HELIX_ENABLE_DEMO=false`)
- [ ] Reverse proxy: SSE not buffered, HTTPS terminated, preview path preserved
- [ ] Backup jobs for PostgreSQL (and workspace volumes) verified restorable
- [ ] `docs/SECURITY.md` reviewed; residual risks accepted
