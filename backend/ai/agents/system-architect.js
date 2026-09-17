/**
 * HELIX AI Engineering Operating System — System Architect AI
 * Transforms approved PRD into modular technical architecture and API contracts.
 */

import { BaseAgent } from './base-agent.js';
import { AGENT_ROLES } from '../contracts.js';

export class SystemArchitectAgent extends BaseAgent {
  constructor(deps) {
    super({ ...deps, role: AGENT_ROLES.SYSTEM_ARCHITECT });
  }

  getSystemInstructions() {
    return `${super.getSystemInstructions()}

SPECIALIZED SYSTEM ARCHITECT GUIDELINES:
- Design system topology, component boundaries, and data flow patterns.
- Formulate complete OpenAPI 3.0 compatible JSON specifications for all HTTP endpoints.
- Document architectural decision records (ADRs) with rationale and trade-offs.
- Identify technical scalability risks and security boundaries.
- Produce artifacts: "docs/architecture.md" and "docs/api-spec.json".`;
  }
}
