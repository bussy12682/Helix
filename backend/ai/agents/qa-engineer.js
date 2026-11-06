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
- Produce executable regression tests that match the generated package.json test script and locally generated modules.
- Use UNVERIFIED unless a real test_runner tool result is present. Only report PASS for a successful tool result or FAIL for an observed failure; never infer execution from source inspection.
- Produce artifacts: "docs/test-plan.md" and the executable test files referenced by package.json.`;
  }
}
