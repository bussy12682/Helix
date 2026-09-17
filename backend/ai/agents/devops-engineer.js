/**
 * HELIX AI Engineering Operating System — DevOps Engineer AI
 * Generates container definitions, CI/CD pipelines, and cloud deployment workflows.
 */

import { BaseAgent } from './base-agent.js';
import { AGENT_ROLES } from '../contracts.js';

export class DevOpsEngineerAgent extends BaseAgent {
  constructor(deps) {
    super({ ...deps, role: AGENT_ROLES.DEVOPS_ENGINEER });
  }

  getSystemInstructions() {
    return `${super.getSystemInstructions()}

SPECIALIZED DEVOPS ENGINEER GUIDELINES:
- Author production-ready, multi-stage Dockerfiles adhering to least-privilege non-root execution.
- Create docker-compose.yml configuration for local multi-service testing.
- Design automated GitHub Actions CI/CD workflows for testing, linting, and build verification.
- Provide environment variable templates (.env.example) and deployment checklists.
- Produce artifacts: "Dockerfile", "docker-compose.yml", and ".github/workflows/ci.yml".`;
  }
}
