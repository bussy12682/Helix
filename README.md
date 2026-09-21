# HELIX — AI Engineering Operating System

**Build software at the speed of thought.**

HELIX is an autonomous AI Engineering Operating System that coordinates nine specialized AI agents to plan, architect, implement, review, test, secure, containerize, and document production-grade software applications.

Rather than relying on isolated chatbots or monolithic prompts, HELIX operates as a structured engineering workforce governed by explicit role contracts, deterministic JSON schemas, a Directed Acyclic Graph (DAG) orchestration engine, permissioned tool execution, and interactive human approval checkpoints.

---

## What's New in V1.0 MVP

- 🚀 **Redesigned Modern Landing Page (`/`)**:
  - Interactive **9-Agent Workforce Explorer** with model tier mapping and live artifact previews.
  - Visual **DAG Workflow Diagram** displaying dependency phases and human review checkpoints.
  - Interactive **Multi-Artifact Code Viewer** displaying production-grade PRDs, PostgreSQL schemas, OpenAPI 3.1 specs, and CI/CD pipelines.
  - Direct **1-Click Live Demo Access** from navigation and hero sections.
  - Side-by-side **Comparison Matrix** (Traditional Agency vs. Single AI Copilot vs. HELIX).
  - Transparent **Pricing Plans** & Interactive **FAQ Accordion**.

- 🔐 **Perfected Authentication Flows**:
  - **1-Click Demo Login (`POST /api/v1/auth/demo`)**: Jump directly into the live AI office with zero setup friction.
  - **Live Password Complexity Checklist**: Real-time visual feedback with checkmarks for 8+ characters, uppercase, lowercase, numbers, and special symbols.
  - **Password Reveal Toggles**: Inline visibility toggles (`Eye` / `EyeOff`) on sign in and sign up forms.
  - **Quick-Fill Helpers**: 1-click test credential generation on both login and signup.
  - **Instant Email Verification**: Auto-detects tokens in query parameters with 1-click verification.

- 🧪 **Comprehensive End-to-End Test Suite (27/27 Passing)**:
  - Added [`backend/tests/real-project-creation.test.js`](backend/tests/real-project-creation.test.js) validating the entire lifecycle: registration $\rightarrow$ verification $\rightarrow$ login $\rightarrow$ demo access $\rightarrow$ real project creation $\rightarrow$ 9-agent DAG workflow $\rightarrow$ human architecture approval $\rightarrow$ human release approval $\rightarrow$ full office state, artifacts, and traces inspection.

---

## Key Features

- **9 Specialized AI Agents**:
  - **Product Manager AI** (`pm`): Turns raw user input into PRDs, User Stories, and Gherkin acceptance criteria.
  - **System Architect AI** (`arch`): Designs system topology, component boundaries, tech stack ADRs, and OpenAPI 3.1 contracts.
  - **Database Engineer AI** (`db`): Models relational entity schemas, migrations, constraints, and query indexes.
  - **Backend Engineer AI** (`be`): Implements REST endpoints, business validation, authentication, and service logic.
  - **Frontend Engineer AI** (`fe`): Constructs responsive React/TanStack UI components with Tailwind CSS and client hooks.
  - **Security Engineer AI** (`sec`): Executes OWASP Top 10 threat modeling, auth audits, and vulnerability checks.
  - **QA Engineer AI** (`qa`): Authors automated test plans, validates PRD acceptance criteria, and issues PASS/FAIL status.
  - **DevOps Engineer AI** (`devops`): Generates production Dockerfiles, docker-compose setups, and GitHub Actions CI/CD.
  - **Documentation Engineer AI** (`docs`): Synthesizes comprehensive README.md files, API reference docs, and setup runbooks.
- **Topological DAG Orchestration**: Executes tasks step-by-step based on topological dependencies with parallel dispatch for independent tasks.
- **Human Approval Checkpoints**: Interactive gates pausing execution for human sign-off on Architecture (`architecture_approval`) and Production Releases (`release_approval`).
- **Automated Review Loops**: Security vulnerabilities or QA test failures automatically trigger structured revision cycles back to engineers.
- **Model Router & Provider Abstraction**:
  - Routes requests dynamically based on cognitive tiers (`Reasoning`, `Coding`, `Fast`).
  - Supports **Google Gemini**, **OpenAI**, **xAI**, local **Ollama** models (`http://localhost:11434`), and zero-config **Offline Mocks**.
- **Context Isolation**: Each agent receives only relevant upstream artifacts to prevent prompt bloat and cross-agent leakage.
- **Permissioned Virtual Tools**: Controlled tool execution including `virtual_workspace_write`, `virtual_workspace_read`, `syntax_validate`, `security_analyzer`, and `test_runner`.
- **Live AI Office Floor**: Real-time event streaming via Server-Sent Events (SSE), showing live agent progress, active tasks, and an interactive artifact inspector.

---

## Architecture

The project is structured into two main layers:

- **Frontend**: A TanStack Router / React 19 / Vite application under `src/`
- **Backend**: A Node.js runtime API & AI orchestration engine under `backend/`

```text
backend/
├── ai/
│   ├── contracts.js          # Explicit contracts & metadata for the 9 agents
│   ├── schemas.js            # Structured JSON schemas & validation rules
│   ├── model-router.js       # Dynamic provider router & cognitive tiering
│   ├── context-manager.js    # Workspace memory & context isolation engine
│   ├── tool-registry.js      # Permissioned virtual tool execution system
│   ├── observability.js      # Execution tracing & SSE telemetry emitter
│   ├── orchestrator.js       # DAG task engine & review loop runner
│   ├── agents/               # Individual agent implementations
│   └── index.js              # Central AI subsystem factory
├── app.js                    # HTTP dispatcher & API endpoints
├── config.js                 # Environment & model configuration loader
├── storage.js                # State persistence engine
└── tests/                    # 27 automated unit, integration, & benchmark tests
```

---

## Quick Start

### 1. Prerequisites
- **Node.js** (v20+ recommended)
- **npm**

### 2. Install Dependencies
```sh
npm install
```

### 3. Configure Environment
Copy the example environment configuration:
```sh
cp .env.example .env.local
```

Key environment variables:
```env
NODE_ENV=development
APP_PORT=3001
APP_NAME=HELIX
BASE_URL=http://localhost:5173
JWT_SECRET=change-me-to-a-secure-random-string
HELIX_STORAGE_PATH=.data/helix-state.json
EMAIL_PROVIDER=demo

# AI Provider Configuration (optional; defaults to offline mock mode if unconfigured)
AI_PROVIDER=google                     # 'google', 'openai', 'xai', or 'ollama'
GOOGLE_AI_API_KEY=your-gemini-api-key
AI_MODEL=gemini-2.5-flash
# OLLAMA_BASE_URL=http://localhost:11434
```

### 4. Run the Application Locally
Start the backend API server:
```sh
node backend/index.js
```

In a separate terminal, start the frontend development server:
```sh
npm run dev
```

Open `http://localhost:5173` in your browser.

---

## Testing & Evaluation

HELIX includes an automated test and benchmark suite covering contracts, schemas, ModelRouter, DAG orchestrator execution, human approval gates, and end-to-end multi-agent evaluation:

```sh
node --test backend/tests/*.js
```

### Test Suite Highlights
- `agent-contracts.test.js` — Validates contracts for all 9 specialized agents.
- `ai.test.js` — Validates brief analysis, voice transcription, and rate-limiting fallbacks.
- `benchmark-evaluation.test.js` — End-to-end multi-agent evaluation on an E-commerce platform.
- `database-foundation.test.js` — Verifies database configuration and safe-mode defaults.
- `foundation.test.js` — Validates project storage persistence across restarts.
- `model-router.test.js` — Tests capability tier routing and Ollama endpoint support.
- `orchestrator-dag.test.js` — Tests DAG dependencies, checkpoint gates, and rejection handling.
- `workflow-api.test.js` — Tests HTTP API endpoints for workflows, office state, and artifacts.
- `real-project-creation.test.js` — Complete integration test verifying user auth, project creation, human approval gates, and full 9-agent workforce execution.

---

## API Summary

### Authentication
- `POST /api/v1/auth/register` — Create user account with complexity validation
- `POST /api/v1/auth/login` — Authenticate user and issue session token
- `POST /api/v1/auth/demo` — Instant 1-click demo login
- `POST /api/v1/auth/verify-email` — Complete email verification
- `POST /api/v1/auth/password-reset/request` — Request password reset token
- `POST /api/v1/auth/password-reset/complete` — Complete password reset

### Projects & Ingestion
- `GET /api/v1/projects` — List workspace projects
- `POST /api/v1/projects` — Create new project
- `POST /api/v1/projects/analyze` — Analyze brief via PM agent
- `POST /api/v1/projects/extract-document` — Extract text from PDF, DOCX, or Markdown specs
- `POST /api/v1/voice/transcribe` — Transcribe voice note
- `POST /api/v1/voice/turn` — Interactive voice briefing turn

### AI Workforce & Orchestration
- `POST /api/v1/projects/:id/workflows` — Initialize and start 9-agent workflow
- `GET /api/v1/projects/:id/workflows` — Retrieve current workflow state and task DAG
- `GET /api/v1/projects/:id/office` — Retrieve live floor state for the 9 agents
- `GET /api/v1/projects/:id/artifacts` — Fetch generated workspace files & code
- `GET /api/v1/projects/:id/workflows/stream` — SSE real-time telemetry stream
- `POST /api/v1/workflows/:id/approve` — Submit Human Approval checkpoint decision
- `GET /api/v1/workflows/:id/traces` — Retrieve execution spans and telemetry metrics

---

## Documentation

Detailed technical documentation is available in [`docs/AI_ARCHITECTURE.md`](docs/AI_ARCHITECTURE.md).

---

## License

Published under the MIT License.

