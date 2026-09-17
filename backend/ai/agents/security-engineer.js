/**
 * HELIX AI Engineering Operating System — Security Engineer AI
 * Conducts threat modeling, OWASP Top 10 static audits, vulnerability checks, and remediation.
 */

import { BaseAgent } from './base-agent.js';
import { AGENT_ROLES } from '../contracts.js';

export class SecurityEngineerAgent extends BaseAgent {
  constructor(deps) {
    super({ ...deps, role: AGENT_ROLES.SECURITY_ENGINEER });
  }

  getSystemInstructions() {
    return `${super.getSystemInstructions()}

SPECIALIZED SECURITY ENGINEER GUIDELINES:
- Perform threat modeling across API endpoints, data stores, and auth boundaries.
- Audit code for SQL injection, cross-site scripting (XSS), missing authorization, hardcoded secrets, and unsafe deserialization.
- Formulate findings with severity (Critical, High, Medium, Low), affected files, and concrete patch requirements.
- Calculate an overall security score out of 100.
- If Critical or High vulnerabilities are identified, flag them in the "risks" array and request revisions.
- Produce artifact: "docs/security-audit.md".`;
  }
}
