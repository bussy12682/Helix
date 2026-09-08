# HELIX

AI Engineering OS for orchestrating intelligent agents to plan, build, test, secure, and manage software.

HELIX is a full-stack TypeScript and JavaScript project that blends a React/TanStack frontend, an authentication API, project creation flows, password-reset and email-verification flows, optional Google/GitHub OAuth, and AI-backed project analysis and voice workflows.

## Project overview

HELIX turns software delivery into an engineering workspace that combines:

- Product and project planning
- Secure authentication and session management
- Email verification and password reset flows
- Project creation, document extraction, AI analysis, and dashboard reporting
- Agent-style workflow scaffolding for future AI orchestration
- A UI inspired by a modern HELIX engineering office

## Architecture

The repository is organized into two major layers:

- Frontend: a TanStack Router / React / Vite project under `src/`
- Backend: a Node HTTP app with Express-style route dispatching under `backend/`

Core files:

- `backend/app.js` — main request router and API handlers
- `backend/config.js` — environment and runtime configuration loader
- `backend/storage.js` — in-memory or persistent storage controller
- `backend/email.js` — SMTP, SendGrid, or demo email transport
- `backend/ai.js` — AI provider integration for analysis and voice routes
- `src/lib/api.ts` — frontend API client wrapper
- `src/routes/` — UI routes such as login, signup, dashboard, and auth callbacks

## Authentication flow

The backend supports:

- Email/password account creation through `POST /api/v1/auth/register`
- Email verification through `POST /api/v1/auth/verify-email`
- Login through `POST /api/v1/auth/login`
- Password reset request and completion endpoints
- Optional Google OAuth and GitHub OAuth callbacks

The default local server configuration uses a memory store and a demo email provider, so account creation and login work locally without external SMTP credentials. In production or a real deployment, you can set SMTP or SendGrid credentials and external OAuth credentials.

## Local setup

### Prerequisites

- Node.js
- npm
- A GitHub or Google OAuth app for external authentication if you want to enable OAuth
- Optional SMTP or SendGrid credentials for production email delivery

### Install dependencies

```sh
npm install
```

### Configure environment

Create a local environment file from the example:

```sh
cp .env.example .env.local
```

The local environment file contains values such as:

```env
NODE_ENV=development
APP_PORT=3001
APP_NAME=HELIX
BASE_URL=http://localhost:5173
JWT_SECRET=change-me-to-a-secure-random-string
DATABASE_URL=
HELIX_STORAGE_PATH=.data/helix-state.json
EMAIL_PROVIDER=demo
VITE_API_BASE_URL=http://localhost:3001
```

Use `EMAIL_PROVIDER=demo` while testing locally if you do not have SMTP credentials configured. The demo email provider will print the verification token to the backend console.

### Run locally

Start the backend API:

```sh
node backend/index.js
```

Then start the frontend:

```sh
npm run dev
```

The frontend uses the Vite development server at the default Vite port. The backend runs on port `3001` by default.

## Available routes

The frontend route tree includes major app surfaces such as:

- `/login`
- `/signup`
- `/verify-email`
- `/forgot-password`
- `/dashboard`
- `/projects`
- `/deployments`
- `/integrations`
- `/security`
- `/auth/google/callback`
- `/auth/github/callback`

## Backend API shape

The main public API groups are:

- `GET /api/v1/health`
- `POST /api/v1/auth/register`
- `POST /api/v1/auth/login`
- `POST /api/v1/auth/google/callback`
- `POST /api/v1/auth/github/callback`
- `POST /api/v1/auth/password-reset/request`
- `POST /api/v1/auth/password-reset/complete`
- `POST /api/v1/auth/verify-email`

Project and document routes include:

- `GET /api/v1/projects`
- `POST /api/v1/projects`
- `GET /api/v1/projects/:id`
- `DELETE /api/v1/projects/:id`
- `POST /api/v1/projects/analyze`
- `POST /api/v1/projects/extract-document`

## AI and project support

The project includes AI-backed features for:

- Project brief analysis
- Voice-turn handling
- Voice note transcription via Google/Gemini-compatible endpoints
- Document text extraction for Markdown, Markdown-like documents, TXT, PDF, and DOCX files

The configuration loader supports the same provider family in several environments:

- `google`
- `openai`
- `xai`

## Security

The backend performs password verification using a server-side hash with the configured JWT secret and supports a session token model. Password validation and rate limiting are included in the route handlers.

## Demo and development notes

The repository contains a safe-memory database fallback that allows the system to initialize without a `DATABASE_URL`. This means the app can run in an offline or local demo environment without an external Postgres service. The demo email provider logs tokens to the console, ensuring signup and email verification can be tested without real SMTP credentials.

## License

This repository is published as a HELIX codebase for local development and engineering orchestration workflows.
