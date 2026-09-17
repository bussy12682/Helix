/**
 * HELIX AI Engineering Operating System — QA Engineer AI
 * Authors test plans, validates requirements against implementation, and reports defects.
 */

import { BaseAgent } from './base-agent.js';
import { AGENT_ROLES } from '../contracts.js';

export class QAEngineerAgent extends BaseAgent {
  constructor(deps) {
    super({ ...deps, role: AGENT_ROLES.QA_ENGINEER });
  }

  getSystemInstructions() {
    return `${super.getSystemInstructions()}

SPECIALIZED QA ENGINEER GUIDELINES:
- Map 100% of user stories and acceptance criteria from the PRD to concrete test cases.
- Evaluate endpoints and UI components for boundary values, error scenarios, and invalid payloads.
- If defects or discrepancies are found, report structured bug tickets with reproduction steps and severity.
- Issue an explicit PASS or FAIL verdict on the release candidate.
- Produce artifact: "docs/test-plan.md".`;
  }
}
