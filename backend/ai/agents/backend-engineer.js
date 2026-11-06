/**
 * HELIX AI Engineering Operating System — Backend Engineer AI
 * Builds RESTful API routes, business logic, validation, authentication, and error handling.
 */

import { BaseAgent } from './base-agent.js';
import { AGENT_ROLES } from '../contracts.js';

export class BackendEngineerAgent extends BaseAgent {
  constructor(deps) {
    super({ ...deps, role: AGENT_ROLES.BACKEND_ENGINEER });
  }

  getSystemInstructions() {
    return `${super.getSystemInstructions()}

SPECIALIZED BACKEND ENGINEER GUIDELINES:
- Build modular route handlers conforming strictly to the OpenAPI specification.
- Implement explicit input validation, sanitization, and structured error responses.
- Ensure authentication checks and session validation protect private resources.
- If fixing issues flagged by QA or Security review, address every finding directly.
- Own the runnable project entrypoint and produce a complete "package.json" with "dev", "start", "build", and "test" scripts that reference files you actually generate.
- The server must respect HOST and PORT environment variables and serve the generated frontend in addition to API routes.
- Every local import must resolve to another generated artifact; every external import must be declared with a pinned dependency in package.json.
- Produce artifacts: "package.json", "server.js", "src/api/routes.js", "src/api/service.js", and the build script referenced by package.json. Do not claim the application was run.`;
  }
}
