# HELIX AI Engineering Operating System — AI Layer Architecture

## 1. Executive Summary
HELIX is an autonomous AI Engineering Operating System that coordinates nine specialized AI agents to plan, architect, implement, review, test, secure, containerize, and document production-grade software applications. Rather than presenting isolated chatbots, HELIX functions as an engineering workforce governed by explicit role contracts, deterministic JSON schemas, a Directed Acyclic Graph (DAG) orchestration engine, permissioned tool execution, and interactive human approval gates.

---

## 2. The Nine Specialized Agents & Contracts

| # | Agent Role | Title | Core Responsibilities | Inputs | Primary Outputs | Allowed Tools | Approval Gate |
|---|------------|-------|-----------------------|--------|-----------------|---------------|---------------|
| 1 | `product_manager` | Product Manager AI | User stories, Gherkin acceptance criteria, MVP prioritization, constraints | User brief, conversation turns, uploaded documents | `docs/prd.md` | `virtual_workspace_read` | None |
| 2 | `system_architect` | Architecture AI | Component topology, OpenAPI 3.0 specs, tech stack ADRs, risk evaluation | PRD, technical constraints | `docs/architecture.md`, `docs/api-spec.json` | `virtual_workspace_read` | **Human Architecture Sign-Off** |
| 3 | `database_engineer` | Database AI | Relational schema modeling, migration scripts, constraints, indexes | Architecture spec, PRD data models | `database/schema.sql` | `virtual_workspace_write`, `syntax_validate` | **Schema Migration Sign-Off** |
| 4 | `backend_engineer` | Backend AI | REST endpoints, business validation, auth middleware, error handlers | OpenAPI spec, Database schema | `src/api/routes.js`, `src/api/service.js` | `virtual_workspace_write`, `syntax_validate` | None |
| 5 | `frontend_engineer` | Frontend AI | Responsive UI views, React components, state management, API client | PRD user stories, OpenAPI spec | `src/components/AppView.tsx`, `src/lib/client-api.ts` | `virtual_workspace_write`, `syntax_validate` | None |
| 6 | `security_engineer` | Security AI | OWASP Top 10 threat modeling, auth audits, injection scans, secret checks | Architecture, API routes, DB schema | `docs/security-audit.md` | `security_analyzer`, `virtual_workspace_read` | **High/Critical Override** |
| 7 | `qa_engineer` | QA AI | Test plan mapping, edge case analysis, requirement compliance verification | PRD acceptance criteria, routes, UI components | `docs/test-plan.md` | `test_runner`, `virtual_workspace_read` | None |
| 8 | `devops_engineer` | DevOps AI | Multi-stage Dockerfiles, docker-compose, GitHub Actions CI/CD workflows | Architecture spec, QA test requirements | `Dockerfile`, `docker-compose.yml`, `.github/workflows/ci.yml` | `virtual_workspace_write`, `syntax_validate` | **Production Release Gate** |
| 9 | `documentation_engineer` | Documentation AI | Production README.md, API reference docs, setup and deployment runbooks | PRD, Architecture spec, API spec, DevOps configs | `README.md`, `docs/api-reference.md` | `virtual_workspace_write` | None |

---

## 3. Standardized Output Schema
Every agent produces a validated JSON payload conforming to the following structure:
```json
{
  "agent": "system_architect",
  "status": "completed",
  "task_id": "TASK-002",
  "summary": "Designed microservices architecture and OpenAPI 3.0 contracts.",
  "artifacts": [
    {
      "name": "api-spec.json",
      "type": "spec",
      "path": "docs/specs/api-spec.json",
      "content": "..."
    }
  ],
  "decisions": [
    { "key": "auth_strategy", "decision": "JWT with refresh token rotation", "rationale": "Stateless horizontal scalability" }
  ],
  "dependencies": ["TASK-001"],
  "risks": [
    { "severity": "medium", "description": "Rate limiting needed on auth endpoints" }
  ],
  "next_actions": ["database_engineer", "backend_engineer"]
}
```

---

## 4. Orchestration & Topological Execution Flow
The orchestrator coordinates the agents through an explicit dependency graph:
```
[User Project Brief]
        │
        ▼
[Product Manager] ──► Produces PRD & User Stories
        │
        ▼
[System Architect] ──► Produces Architecture & OpenAPI Specs
        │
        ▼ ◄─────────────────────────── [Human Architecture Checkpoint]
        ├─────────────────────────────┐
        ▼                             ▼
[Database Engineer]           [Frontend Engineer]
        │                             │
        ▼                             │
[Backend Engineer]                    │
        │                             │
        ▼                             ▼
   (Implementation Complete) ─────────┘
        │
        ├─────────────────────────────┐
        ▼                             ▼
[Security Engineer]             [QA Engineer]
        │                             │
        └──────────────┬──────────────┘
                       ▼
              (Automated Review Loop)
       Are defects or high risks detected?
        ├── YES ──► (Feedback routed to Backend/Frontend for auto-repair)
        └── NO  ──► Continue
                       │
                       ▼ ◄──────────── [Human Release Checkpoint]
                       ├──────────────┐
                       ▼              ▼
               [DevOps Engineer]  [Documentation Engineer]
                       │              │
                       └───────┬──────┘
                               ▼
                        [Project Complete]
```

---

## 5. Model Routing & Cognitive Tiers
HELIX remains model-agnostic via `ModelRouter`:
- **Reasoning Tier** (`gemini-2.5-pro` / `gpt-4o` / `grok-3` / `llama3.1:8b`): High-complexity agents (Product Manager, System Architect, Security Engineer).
- **Coding Tier** (`gemini-2.5-flash` / `gpt-4o-mini` / `qwen2.5-coder:7b`): Syntactically exact agents (Database, Backend, Frontend).
- **Fast Tier** (`gemini-2.5-flash` / `gpt-4o-mini` / `qwen2.5:3b`): High-throughput agents (QA, DevOps, Documentation, summarization).
- **Ollama Support**: Configurable via `OLLAMA_BASE_URL` with zero code modifications.
- **Offline Mock Provider**: Deterministic offline simulation for tests and keyless local development.

---

## 6. Context Isolation & Memory Management
- **Task Context**: Transient input and parameters scoped strictly to an agent's current task.
- **Workspace Memory**: Cleanly isolated repository of versioned artifacts (`name`, `type`, `path`, `version`) and approved architectural decisions.
- **Isolation Policy**: Frontend agents never receive database index tuning internals or security exploit logs; Security agents only inspect schemas, routes, and controllers.

---

## 7. Permissioned Tools & Sandboxing
Tool execution enforces strict least-privilege permissions:
- `virtual_workspace_write`: Write generated code/specs to the project's virtual file tree.
- `virtual_workspace_read`: Read upstream project artifacts.
- `syntax_validate`: Verify syntax of JS, TS, SQL, JSON, or YAML before accepting.
- `security_analyzer`: AST regex scanner detecting hardcoded secrets, eval calls, and SQL injection strings.
- `test_runner`: Evaluates test assertions and outputs PASS / FAIL metrics.

---

## 8. Observability & Tracing
- **Spans**: Every agent task records start time, end time, duration, token usage, tool calls, status, and error stack.
- **Live SSE Event Stream**: Emits `workflow_created`, `task_started`, `task_completed`, `checkpoint_reached`, and `review_loop_triggered` events to the frontend AI Office.
