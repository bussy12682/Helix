/**
 * HELIX AI Engineering Operating System — Agent Workforce Registry
 * Instantiates and provides access to all nine specialized engineering agents.
 */

import { AGENT_ROLES } from '../contracts.js';
import { ProductManagerAgent } from './product-manager.js';
import { SystemArchitectAgent } from './system-architect.js';
import { DatabaseEngineerAgent } from './database-engineer.js';
import { BackendEngineerAgent } from './backend-engineer.js';
import { FrontendEngineerAgent } from './frontend-engineer.js';
import { SecurityEngineerAgent } from './security-engineer.js';
import { QAEngineerAgent } from './qa-engineer.js';
import { DevOpsEngineerAgent } from './devops-engineer.js';
import { DocumentationEngineerAgent } from './documentation-engineer.js';

export function createAgentWorkforce({ modelRouter, toolRegistry, observability }) {
  const deps = { modelRouter, toolRegistry, observability };

  const agents = {
    [AGENT_ROLES.PRODUCT_MANAGER]: new ProductManagerAgent(deps),
    [AGENT_ROLES.SYSTEM_ARCHITECT]: new SystemArchitectAgent(deps),
    [AGENT_ROLES.DATABASE_ENGINEER]: new DatabaseEngineerAgent(deps),
    [AGENT_ROLES.BACKEND_ENGINEER]: new BackendEngineerAgent(deps),
    [AGENT_ROLES.FRONTEND_ENGINEER]: new FrontendEngineerAgent(deps),
    [AGENT_ROLES.SECURITY_ENGINEER]: new SecurityEngineerAgent(deps),
    [AGENT_ROLES.QA_ENGINEER]: new QAEngineerAgent(deps),
    [AGENT_ROLES.DEVOPS_ENGINEER]: new DevOpsEngineerAgent(deps),
    [AGENT_ROLES.DOCUMENTATION_ENGINEER]: new DocumentationEngineerAgent(deps),
  };

  return {
    getAgent(role) {
      const agent = agents[role];
      if (!agent) {
        throw new Error(`Agent for role "${role}" is not registered in the workforce.`);
      }
      return agent;
    },
    getAllAgents() {
      return agents;
    },
  };
}
