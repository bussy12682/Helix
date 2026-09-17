/**
 * HELIX AI Engineering Operating System — Context & Memory Manager
 * Enforces strict context isolation between agents, provides role-specific
 * project context, and tracks versioned artifacts and approved decisions.
 */

import { AGENT_ROLES } from './contracts.js';

export class ContextManager {
  constructor() {
    // In-memory workspace cache indexed by projectId
    this.projectWorkspaces = new Map();
  }

  /**
   * Initializes or fetches an isolated project workspace context.
   */
  getOrCreateWorkspace(projectId, initialData = {}) {
    if (!this.projectWorkspaces.has(projectId)) {
      this.projectWorkspaces.set(projectId, {
        projectId,
        name: initialData.name || 'Untitled Project',
        description: initialData.description || '',
        keyFeatures: initialData.keyFeatures || [],
        techStack: initialData.techStack || [],
        approvedDecisions: [],
        artifacts: new Map(), // key: artifact path, value: { name, type, path, content, version, createdBy }
        reviewFindings: [],
        taskHistory: [],
      });
    }
    return this.projectWorkspaces.get(projectId);
  }

  /**
   * Stores or updates an artifact within the workspace with version incrementing.
   */
  saveArtifact(projectId, { name, type, path, content, createdBy, taskId }) {
    const ws = this.getOrCreateWorkspace(projectId);
    const existing = ws.artifacts.get(path);
    const version = existing ? existing.version + 1 : 1;

    const record = {
      name,
      type,
      path,
      content,
      version,
      createdBy,
      taskId,
      updatedAt: new Date().toISOString(),
    };

    ws.artifacts.set(path, record);
    return record;
  }

  /**
   * Retrieves all artifacts in a project workspace.
   */
  getArtifacts(projectId) {
    const ws = this.getOrCreateWorkspace(projectId);
    return [...ws.artifacts.values()];
  }

  /**
   * Records an approved architectural or engineering decision.
   */
  addDecision(projectId, decision) {
    const ws = this.getOrCreateWorkspace(projectId);
    ws.approvedDecisions.push({
      ...decision,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Builds isolated, role-tailored context for an agent execution.
   * Prevents cross-agent token bloat and context leakage.
   */
  buildAgentContext(projectId, agentRole, taskInput = {}) {
    const ws = this.getOrCreateWorkspace(projectId);

    const baseProjectInfo = {
      name: ws.name,
      description: ws.description,
      keyFeatures: ws.keyFeatures,
      techStack: ws.techStack,
      approvedDecisions: ws.approvedDecisions,
    };

    const artifacts = ws.artifacts;

    // Helper to extract artifact content by name/path fragment
    const getArtifact = (pathFragment) => {
      for (const [p, art] of artifacts.entries()) {
        if (p.includes(pathFragment) || art.name.includes(pathFragment)) {
          return art.content;
        }
      }
      return null;
    };

    let relevantArtifacts = {};

    switch (agentRole) {
      case AGENT_ROLES.PRODUCT_MANAGER:
        // PM only needs the user's initial idea and input document text
        return {
          project: baseProjectInfo,
          taskInput: {
            userBrief: taskInput.userBrief || ws.description,
            uploadedDocs: taskInput.uploadedDocs || null,
            conversation: taskInput.conversation || [],
          },
        };

      case AGENT_ROLES.SYSTEM_ARCHITECT:
        // Architect needs PRD and core requirements
        relevantArtifacts.prd = getArtifact('prd');
        return {
          project: baseProjectInfo,
          relevantArtifacts,
          taskInput,
        };

      case AGENT_ROLES.DATABASE_ENGINEER:
        // Database AI needs PRD and Architecture spec
        relevantArtifacts.prd = getArtifact('prd');
        relevantArtifacts.architecture = getArtifact('architecture');
        return {
          project: baseProjectInfo,
          relevantArtifacts,
          taskInput,
        };

      case AGENT_ROLES.BACKEND_ENGINEER:
        // Backend AI needs Architecture, OpenAPI spec, and Database schema
        relevantArtifacts.architecture = getArtifact('architecture');
        relevantArtifacts.apiSpec = getArtifact('api-spec');
        relevantArtifacts.schema = getArtifact('schema.sql');
        return {
          project: baseProjectInfo,
          relevantArtifacts,
          taskInput,
          reviewFeedback: taskInput.reviewFeedback || null,
        };

      case AGENT_ROLES.FRONTEND_ENGINEER:
        // Frontend AI needs PRD, Architecture, and API contracts (no database internals)
        relevantArtifacts.prd = getArtifact('prd');
        relevantArtifacts.architecture = getArtifact('architecture');
        relevantArtifacts.apiSpec = getArtifact('api-spec');
        return {
          project: baseProjectInfo,
          relevantArtifacts,
          taskInput,
          reviewFeedback: taskInput.reviewFeedback || null,
        };

      case AGENT_ROLES.SECURITY_ENGINEER:
        // Security AI needs API routes, Database schema, and Architecture
        relevantArtifacts.architecture = getArtifact('architecture');
        relevantArtifacts.apiSpec = getArtifact('api-spec');
        relevantArtifacts.schema = getArtifact('schema.sql');
        relevantArtifacts.backendRoutes = getArtifact('routes');
        return {
          project: baseProjectInfo,
          relevantArtifacts,
          taskInput,
        };

      case AGENT_ROLES.QA_ENGINEER:
        // QA AI needs PRD acceptance criteria, API routes, and Frontend components
        relevantArtifacts.prd = getArtifact('prd');
        relevantArtifacts.apiSpec = getArtifact('api-spec');
        relevantArtifacts.backendRoutes = getArtifact('routes');
        relevantArtifacts.frontendViews = getArtifact('tsx') || getArtifact('jsx');
        return {
          project: baseProjectInfo,
          relevantArtifacts,
          taskInput,
        };

      case AGENT_ROLES.DEVOPS_ENGINEER:
        // DevOps needs Architecture, Stack, and QA test plan
        relevantArtifacts.architecture = getArtifact('architecture');
        relevantArtifacts.qaReport = getArtifact('test-plan');
        return {
          project: baseProjectInfo,
          relevantArtifacts,
          taskInput,
        };

      case AGENT_ROLES.DOCUMENTATION_ENGINEER:
        // Documentation needs PRD, Architecture, API spec, and DevOps configs
        relevantArtifacts.prd = getArtifact('prd');
        relevantArtifacts.architecture = getArtifact('architecture');
        relevantArtifacts.apiSpec = getArtifact('api-spec');
        relevantArtifacts.dockerfile = getArtifact('Dockerfile');
        return {
          project: baseProjectInfo,
          relevantArtifacts,
          taskInput,
        };

      default:
        return { project: baseProjectInfo, taskInput };
    }
  }

  /**
   * Resets workspace memory when a project is deleted or re-initialized.
   */
  clearWorkspace(projectId) {
    this.projectWorkspaces.delete(projectId);
  }
}
