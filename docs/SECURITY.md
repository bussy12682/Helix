# HELIX Security Model

This document describes the security controls that exist in the codebase today,
with pointers to the enforcing code, and names the residual risks that are
**not** yet covered. It is written to be verifiable: every claim cites the
mechanism that enforces it, and the automated tests that would break if the
control regressed.

## 1. Sandbox execution isolation (`backend/execution-service.js`)

Every user-supplied command runs through `prlimit` + `bubblewrap`:

| Control | Mechanism |
| --- | --- |
| Namespace isolation | `bwrap --unshare-all --die-with-parent --new-session` — no IPC/UTS/net (default), process group is killed with the parent |
| Capabilities | `--cap-drop ALL` |
| Filesystem | Host `/usr` mounted read-only; `/lib*` as symlinks; only the project workspace is writable (`--bind <root> /workspace --chdir /workspace`); `/tmp` is a 64 MiB tmpfs; `/dev` and `/proc` are kernel devices, not host binds |
| Network | Disabled by default; enabled per-job only for lifecycle operations (`allowNetwork`) via `--share-net` |
| Resource ceilings | `prlimit --cpu=<timeout s> --as=4GiB --nofile=256 --nproc=64 --fsize=16MiB`; Node heap capped at 512 MiB via `NODE_OPTIONS` |
| Process limits | Hard wall-clock timeout (`SIGKILL` of the detached process group), 1 MiB captured-output cap (kill on overflow) |
| Executable allowlist | `node`, `npm`, `npx`, `python3` only; absolute paths rejected (`ALLOWED_EXECUTABLES`) |
| Environment scrubbing | Only `HOST`, `PORT`, `NODE_ENV`, `npm_config_cache` may pass through (`SAFE_ENV_KEYS`); the child environment is constructed explicitly, never inherited — provider keys and `DATABASE_URL` cannot leak into a job |

Availability is **probed, not assumed**: `getStatus()` runs a real bubblewrap
probe; if isolation is unavailable, jobs report `UNAVAILABLE` rather than
running unsandboxed.

Tests: `backend/tests/workspace-execution.test.js`, `security-hardening.test.js`
(sandbox-controls test fails if the allowlist, namespace flags, or env scrubbing
regress).

## 2. Tenant isolation (`backend/app.js`)

- Every project-scoped route resolves the session (bearer or opt-in cookie) and
  verifies `project.ownerId === user.id` via `requireProjectAccess` /
  `requireWorkflowAccess` before any data leaves the store.
- Workflow routes (approve/retry/cancel/traces/stream) enforce the same
  ownership check; cross-tenant attempts are asserted to fail in
  `backend/tests/security.test.js`.
- Preview URLs embed a per-preview capability token (32 random bytes,
  `base64url`) compared with a timing-safe comparison; preview ports are
  loopback-only and **allocated by the server** (caller-selected ports would be
  an SSRF primitive — see `application-service.js`).

## 3. Session management

- Sessions are opaque random tokens (`helix.<uuid>`) with expiry (8 h, 30 h with
  *remember me*); expiry is enforced on every read and expired sessions are
  purged from persistent stores on boot.
- **Bearer tokens** are the default credential (Authorization header) and remain
  the only cross-origin mechanism.
- **httpOnly cookies are opt-in** (`HELIX_COOKIE_SESSIONS=true`): login/demo
  login set `helix_session` with `HttpOnly; SameSite=Lax; Path=/` (and `Secure`
  in production), only when the request origin is an allowed CORS origin —
  never for wildcard-origin deployments. Logout clears the cookie and revokes
  the session. When enabled, the cookie is promoted to the standard bearer path
  in one place (`app.request`), so every route accepts either credential with
  identical authorization logic. SameSite=Lax prevents browsers from attaching
  the cookie to cross-site writes.
- Login/register/password-reset are rate limited per identifier
  (`backend/rate-limiter.js`); repeated failures lock the identifier for 15 min.

Known residual risk (documented, deliberately deferred): session tokens are
stored verbatim in the store rather than as hashes. A store-database leak would
expose live tokens until expiry. Hashing at rest requires a migration of
existing persisted sessions and is listed in the production-readiness report as
follow-up hardening.

## 4. Secret handling

- Secrets are provided via environment variables (`.env.local`, git-ignored);
  `.env.example` documents them without values.
- Sandboxed jobs never inherit the process environment (see §1).
- Structured logging (`backend/logger.js`) redacts values of sensitive-looking
  keys (tokens, passwords, API keys, authorization, cookies) recursively,
  including inside arrays; `backend/tests/reliability.test.js` asserts nested
  secrets are redacted.
- The audit trail (`backend/operational-governance.js`) applies the same
  redaction before persistence; `operational-controls.test.js` asserts
  passwords and session tokens never appear in audit records.
- PostgreSQL connection strings are masked (`password → ***`) wherever status
  is reported (`backend/database.js`).

## 5. Preview security

- Capability-token URLs (see §2), `cache-control: no-store`,
  `referrer-policy: no-referrer`, and CSP `frame-ancestors` limited to the
  configured HELIX origins (not `X-Frame-Options`, which cannot express
  cross-origin embedding of a dev frontend).
- Configurable lifetime: `HELIX_PREVIEW_TTL_MS` (default 24 h). Expired
  previews stop their job and their token is rejected (sweep + lazy expiry in
  `application-service.js`).
- The preview proxy strips hop-by-hop headers and `set-cookie` responses from
  the sandboxed app.

## 6. HTTP surface

- Security headers on every response: `x-content-type-options: nosniff`,
  `referrer-policy: no-referrer`, `x-frame-options: DENY` unless CSP
  `frame-ancestors` applies, request-id correlation.
- CORS: origins are reflected only when explicitly allowed; wildcard is
  unavailable in production (asserted in `security.test.js`).
- Body-size cap before parsing (`MAX_BODY_BYTES`, 413).
- AI routes enforce per-user rate limits and token budgets (see
  `docs/OPERATIONS.md` / `backend/operational-governance.js`).

## 7. Passwords

- Complexity validation (`backend/password-validator.js`), salted hashes with
  peppered verification and transparent rehash on login
  (`backend/passwords.js`), verification and reset tokens are single-use with
  1 h expiry, reset flows never reveal whether an account exists.
