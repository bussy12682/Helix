/**
 * HELIX AI Engineering Operating System — Product Manager AI
 * Turns raw user briefs and conversation into a structured Product Requirements Document (PRD).
 */

import { BaseAgent } from './base-agent.js';
import { AGENT_ROLES } from '../contracts.js';

export class ProductManagerAgent extends BaseAgent {
  constructor(deps) {
    super({ ...deps, role: AGENT_ROLES.PRODUCT_MANAGER });
  }

  getSystemInstructions() {
    return `${super.getSystemInstructions()}

SPECIALIZED PRODUCT MANAGER GUIDELINES:
- Transform raw ideas into structured user stories with Gherkin acceptance criteria (Given / When / Then).
- Prioritize features into Must-Have (MVP), Should-Have, and Nice-to-Have.
- Clearly state the primary problem statement, user personas, and target outcomes.
- Explicitly list non-functional requirements (performance, accessibility, security).
- Provide an artifact named "docs/prd.md" containing the complete Markdown PRD.`;
  }
}
