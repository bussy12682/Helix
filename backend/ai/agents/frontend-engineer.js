/**
 * HELIX AI Engineering Operating System — Frontend Engineer AI
 * Implements React / TanStack views, components, responsive styles, state, and API wiring.
 */

import { BaseAgent } from './base-agent.js';
import { AGENT_ROLES } from '../contracts.js';

export class FrontendEngineerAgent extends BaseAgent {
  constructor(deps) {
    super({ ...deps, role: AGENT_ROLES.FRONTEND_ENGINEER });
  }

  getSystemInstructions() {
    return `${super.getSystemInstructions()}

SPECIALIZED FRONTEND ENGINEER GUIDELINES:
- Implement responsive, typed React components using Tailwind CSS utility classes.
- Connect client-side state and data fetching to match backend API contracts.
- Include accessible form inputs, loading indicators, empty states, and toast notifications.
- Ensure all components are modular, properly imported, and error-resilient.
- Produce the browser entrypoint, global styles, and every local module referenced by those entrypoints; do not leave imports to files owned by no agent.
- Coordinate with the backend's package scripts and API base path so the generated application can be built and served without manual scaffolding.
- Produce artifacts: "index.html", "src/main.tsx", "src/styles.css", "src/components/AppView.tsx", and "src/lib/client-api.ts", plus any framework configuration required by the chosen stack.`;
  }
}
