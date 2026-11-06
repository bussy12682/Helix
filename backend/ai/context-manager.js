/**
 * HELIX AI Engineering Operating System — Context & Memory Manager
 * Enforces strict context isolation between agents, provides role-specific
 * project context, and tracks versioned artifacts and approved decisions.
 */

import { AGENT_ROLES } from "./contracts.js";
import { normalizeWorkspacePath } from "../workspace-paths.js";

export class ContextManager {
  constructor({ onChange = null } = {}) {
    // In-memory workspace cache indexed by projectId
    this.projectWorkspaces = new Map();
    this.onChange = onChange;
  }

  setPersistence(onChange) {
    this.onChange = onChange;
  }

  notifyChange(projectId) {
    if (!this.onChange) return;
    const ws = this.projectWorkspaces.get(projectId);
    if (ws) this.onChange(this.serializeWorkspace(ws));
  }

  serializeWorkspace(ws) {
    return { ...ws, artifacts: [...ws.artifacts.values()] };
  }

  /**
   * Restores persisted workspaces (artifacts stored as arrays) into memory.
   */
  hydrate(workspaces = []) {
    for (const ws of workspaces) {
      if (!ws?.projectId) continue;
      const artifacts = new Map();
      for (const artifact of ws.artifacts ?? []) artifacts.set(artifact.path, artifact);
      this.projectWorkspaces.set(ws.projectId, {
        approvedDecisions: [],
        reviewFindings: [],
        taskHistory: [],
        ...ws,
        artifacts,
      });
    }
  }

  /**
   * Refreshes brief fields (name, description, features, stack) after a project is edited.
   */
  updateProjectInfo(projectId, data = {}) {
    const ws = this.projectWorkspaces.get(projectId);
    if (!ws) return;
    for (const key of ["name", "description", "keyFeatures", "techStack"]) {
      if (data[key] !== undefined) ws[key] = data[key];
    }
    this.notifyChange(projectId);
  }

  /**
   * Initializes or fetches an isolated project workspace context.
   */
  getOrCreateWorkspace(projectId, initialData = {}) {
    if (!this.projectWorkspaces.has(projectId)) {
      this.projectWorkspaces.set(projectId, {
        projectId,
        name: initialData.name || "Untitled Project",
        description: initialData.description || "",
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
    const normalizedPath = normalizeWorkspacePath(path);
    if (typeof content !== "string" || Buffer.byteLength(content) > 2 * 1024 * 1024) {
      throw new Error("Artifacts must be UTF-8 strings no larger than 2 MiB");
    }
    const ws = this.getOrCreateWorkspace(projectId);
    const existing = ws.artifacts.get(normalizedPath);
    if (!existing && ws.artifacts.size >= 2000) {
      throw new Error("A maximum of 2,000 files is allowed per workspace");
    }
    const otherBytes = [...ws.artifacts.values()].reduce(
      (total, artifact) => total + (artifact.path === normalizedPath ? 0 : Buffer.byteLength(artifact.content)),
      0,
    );
    if (otherBytes + Buffer.byteLength(content) > 50 * 1024 * 1024) {
      throw new Error("Workspace files exceed the 50 MiB project limit");
    }
    const version = existing ? existing.version + 1 : 1;

    const record = {
      name,
      type,
      path: normalizedPath,
      content,
      version,
      createdBy,
      taskId,
      updatedAt: new Date().toISOString(),
    };

    ws.artifacts.set(normalizedPath, record);
    this.notifyChange(projectId);
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
    this.notifyChange(projectId);
  }

  /**
   * Builds isolated, role-tailored context for an agent execution.
   * Prevents cross-agent token bloat and context leakage.
   */
  buildAgentContext(projectId, agentRole, taskInput = {}) {
    const ws = this.getOrCreateWorkspace(projectId);

    const baseProjectInfo = {
      id: projectId,
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
        relevantArtifacts.prd = getArtifact("prd");
        return {
          project: baseProjectInfo,
          relevantArtifacts,
          taskInput,
        };

      case AGENT_ROLES.DATABASE_ENGINEER:
        // Database AI needs PRD and Architecture spec
        relevantArtifacts.prd = getArtifact("prd");
        relevantArtifacts.architecture = getArtifact("architecture");
        return {
          project: baseProjectInfo,
          relevantArtifacts,
          taskInput,
        };

      case AGENT_ROLES.BACKEND_ENGINEER:
        // Backend AI needs Architecture, OpenAPI spec, and Database schema
        relevantArtifacts.architecture = getArtifact("architecture");
        relevantArtifacts.apiSpec = getArtifact("api-spec");
        relevantArtifacts.schema = getArtifact("schema.sql");
        return {
          project: baseProjectInfo,
          relevantArtifacts,
          taskInput,
          reviewFeedback: taskInput.reviewFeedback || null,
        };

      case AGENT_ROLES.FRONTEND_ENGINEER:
        // Frontend AI needs PRD, Architecture, and API contracts (no database internals)
        relevantArtifacts.prd = getArtifact("prd");
        relevantArtifacts.architecture = getArtifact("architecture");
        relevantArtifacts.apiSpec = getArtifact("api-spec");
        return {
          project: baseProjectInfo,
          relevantArtifacts,
          taskInput,
          reviewFeedback: taskInput.reviewFeedback || null,
        };

      case AGENT_ROLES.SECURITY_ENGINEER:
        // Security AI needs API routes, Database schema, and Architecture
        relevantArtifacts.architecture = getArtifact("architecture");
        relevantArtifacts.apiSpec = getArtifact("api-spec");
        relevantArtifacts.schema = getArtifact("schema.sql");
        relevantArtifacts.backendRoutes = getArtifact("routes");
        return {
          project: baseProjectInfo,
          relevantArtifacts,
          taskInput,
        };

      case AGENT_ROLES.QA_ENGINEER:
        // QA AI needs PRD acceptance criteria, API routes, and Frontend components
        relevantArtifacts.prd = getArtifact("prd");
        relevantArtifacts.apiSpec = getArtifact("api-spec");
        relevantArtifacts.backendRoutes = getArtifact("routes");
        relevantArtifacts.frontendViews = getArtifact("tsx") || getArtifact("jsx");
        return {
          project: baseProjectInfo,
          relevantArtifacts,
          taskInput,
        };

      case AGENT_ROLES.DEVOPS_ENGINEER:
        // DevOps needs Architecture, Stack, and QA test plan
        relevantArtifacts.architecture = getArtifact("architecture");
        relevantArtifacts.qaReport = getArtifact("test-plan");
        return {
          project: baseProjectInfo,
          relevantArtifacts,
          taskInput,
        };

      case AGENT_ROLES.DOCUMENTATION_ENGINEER:
        // Documentation needs PRD, Architecture, API spec, and DevOps configs
        relevantArtifacts.prd = getArtifact("prd");
        relevantArtifacts.architecture = getArtifact("architecture");
        relevantArtifacts.apiSpec = getArtifact("api-spec");
        relevantArtifacts.dockerfile = getArtifact("Dockerfile");
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
