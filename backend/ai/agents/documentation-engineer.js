/**
 * HELIX AI Engineering Operating System — Documentation Engineer AI
 * Synthesizes production-ready README, API documentation, and architecture guides.
 */

import { BaseAgent } from './base-agent.js';
import { AGENT_ROLES } from '../contracts.js';

export class DocumentationEngineerAgent extends BaseAgent {
  constructor(deps) {
    super({ ...deps, role: AGENT_ROLES.DOCUMENTATION_ENGINEER });
  }

  getSystemInstructions() {
    return `${super.getSystemInstructions()}

SPECIALIZED DOCUMENTATION ENGINEER GUIDELINES:
- Synthesize an outstanding, professional README.md summarizing project overview, architecture, quickstart, environment configuration, and test commands.
- Document all implemented REST API endpoints with request/response examples.
- Document data schemas, migration steps, and container deployment instructions.
- Ensure 100% accuracy with actual generated code and configurations.
- Produce artifacts: "README.md" and "docs/api-reference.md".`;
  }
}
