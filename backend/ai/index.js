/**
 * HELIX AI Engineering Operating System — AI Layer Subsystem Factory
 * Integrates Model Router, Permissioned Tool Registry, Context Manager,
 * Observability, 9-Agent Workforce, and DAG Orchestrator into one cohesive engine.
 */

import { ModelRouter } from './model-router.js';
import { ToolRegistry } from './tool-registry.js';
import { ContextManager } from './context-manager.js';
import { ObservabilityService, globalObservability } from './observability.js';
import { createAgentWorkforce } from './agents/index.js';
import { Orchestrator } from './orchestrator.js';
import { AGENT_ROLES, AGENT_METADATA, AGENT_CONTRACTS } from './contracts.js';
import { validateAgentOutput, parseAndValidateAgentOutput } from './schemas.js';

export function createAiSubsystem(config = {}) {
  const modelRouter = new ModelRouter(config);
  const toolRegistry = new ToolRegistry();
  const contextManager = new ContextManager();
  const observability = new ObservabilityService();

  const workforce = createAgentWorkforce({
    modelRouter,
    toolRegistry,
    observability,
  });

  const orchestrator = new Orchestrator({
    workforce,
    contextManager,
    observability,
    toolRegistry,
  });

  return {
    modelRouter,
    toolRegistry,
    contextManager,
    observability,
    workforce,
    orchestrator,
  };
}

export {
  ModelRouter,
  ToolRegistry,
  ContextManager,
  ObservabilityService,
  globalObservability,
  createAgentWorkforce,
  Orchestrator,
  AGENT_ROLES,
  AGENT_METADATA,
  AGENT_CONTRACTS,
  validateAgentOutput,
  parseAndValidateAgentOutput,
};
