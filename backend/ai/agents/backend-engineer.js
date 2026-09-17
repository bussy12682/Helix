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
- Produce artifacts: "src/api/routes.js" and "src/api/service.js".`;
  }
}
