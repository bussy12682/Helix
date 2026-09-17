/**
 * HELIX AI Engineering Operating System — Workflow Orchestration Engine
 * Coordinates the 9 specialized agents through an explicit Directed Acyclic Graph (DAG),
 * human approval gates, automated review loops (QA & Security), and context isolation.
 */

import { randomUUID } from 'node:crypto';
import { AGENT_ROLES, AGENT_METADATA } from './contracts.js';

export const WORKFLOW_STATUS = {
  PENDING: 'pending',
  RUNNING: 'running',
  AWAITING_APPROVAL: 'awaiting_approval',
  COMPLETED: 'completed',
  FAILED: 'failed',
};

export const TASK_STATUS = {
  QUEUED: 'queued',
  RUNNING: 'running',
  AWAITING_APPROVAL: 'awaiting_approval',
  COMPLETED: 'completed',
  NEEDS_REVISION: 'needs_revision',
  FAILED: 'failed',
};

export class Orchestrator {
  constructor({ workforce, contextManager, observability, toolRegistry, storage }) {
    this.workforce = workforce;
    this.contextManager = contextManager;
    this.observability = observability;
    this.toolRegistry = toolRegistry;
    this.storage = storage;

    // In-memory active workflows cache
    this.workflows = new Map();
  }

  /**
   * Initializes a coordinated 9-agent engineering workflow for a project.
   */
  async createWorkflow(projectId, projectData = {}) {
    const workflowId = `wf_${randomUUID()}`;

    // Initialize isolated workspace context
    this.contextManager.getOrCreateWorkspace(projectId, projectData);

    const initialTasks = [
      {
        id: `task_${randomUUID()}`,
        agent: AGENT_ROLES.PRODUCT_MANAGER,
        title: 'Define Product Requirements & User Stories',
        status: TASK_STATUS.QUEUED,
        dependencies: [],
        progress: 0,
        output: null,
        reviewFindings: [],
      },
      {
        id: `task_${randomUUID()}`,
        agent: AGENT_ROLES.SYSTEM_ARCHITECT,
        title: 'Formulate Architecture, Tech Stack & API Specs',
        status: TASK_STATUS.QUEUED,
        dependencies: [0], // indexes to be resolved to IDs
        progress: 0,
        output: null,
        requiresApproval: 'architecture_approval',
        reviewFindings: [],
      },
      {
        id: `task_${randomUUID()}`,
        agent: AGENT_ROLES.DATABASE_ENGINEER,
        title: 'Model Relational Schemas, Constraints & Indexes',
        status: TASK_STATUS.QUEUED,
        dependencies: [1],
        progress: 0,
        output: null,
        reviewFindings: [],
      },
      {
        id: `task_${randomUUID()}`,
        agent: AGENT_ROLES.BACKEND_ENGINEER,
        title: 'Build API Endpoints, Business Logic & Security',
        status: TASK_STATUS.QUEUED,
        dependencies: [1, 2],
        progress: 0,
        output: null,
        reviewFindings: [],
      },
      {
        id: `task_${randomUUID()}`,
        agent: AGENT_ROLES.FRONTEND_ENGINEER,
        title: 'Implement UI Views, Components & State Management',
        status: TASK_STATUS.QUEUED,
        dependencies: [1], // can run parallel with database & backend
        progress: 0,
        output: null,
        reviewFindings: [],
      },
      {
        id: `task_${randomUUID()}`,
        agent: AGENT_ROLES.SECURITY_ENGINEER,
        title: 'Execute Threat Modeling & Security Review',
        status: TASK_STATUS.QUEUED,
        dependencies: [3],
        progress: 0,
        output: null,
        reviewFindings: [],
      },
      {
        id: `task_${randomUUID()}`,
        agent: AGENT_ROLES.QA_ENGINEER,
        title: 'Run QA Test Suite & Requirement Verification',
        status: TASK_STATUS.QUEUED,
        dependencies: [3, 4],
        progress: 0,
        output: null,
        reviewFindings: [],
      },
      {
        id: `task_${randomUUID()}`,
        agent: AGENT_ROLES.DEVOPS_ENGINEER,
        title: 'Generate Containerization & CI/CD Pipelines',
        status: TASK_STATUS.QUEUED,
        dependencies: [5, 6],
        progress: 0,
        output: null,
        requiresApproval: 'release_approval',
        reviewFindings: [],
      },
      {
        id: `task_${randomUUID()}`,
        agent: AGENT_ROLES.DOCUMENTATION_ENGINEER,
        title: 'Synthesize README & Developer Documentation',
        status: TASK_STATUS.QUEUED,
        dependencies: [7],
        progress: 0,
        output: null,
        reviewFindings: [],
      },
    ];

    // Resolve index dependencies to concrete task IDs
    const resolvedTasks = initialTasks.map((t, idx) => ({
      ...t,
      dependencies: t.dependencies.map((depIdx) => initialTasks[depIdx].id),
    }));

    const workflow = {
      id: workflowId,
      projectId,
      status: WORKFLOW_STATUS.PENDING,
      currentCheckpoint: null,
      reviewLoopCount: 0,
      tasks: resolvedTasks,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    this.workflows.set(workflowId, workflow);
    this.observability.emitEvent('workflow_created', { workflowId, projectId });

    return workflow;
  }

  getWorkflow(workflowId) {
    return this.workflows.get(workflowId) || null;
  }

  getWorkflowForProject(projectId) {
    for (const wf of this.workflows.values()) {
      if (wf.projectId === projectId) return wf;
    }
    return null;
  }

  /**
   * Evaluates the task DAG and executes all tasks whose prerequisites are satisfied.
   * Runs independent tasks concurrently when appropriate.
   * Pauses when a human approval checkpoint is hit.
   */
  async runNextSteps(workflowId, options = {}) {
    const workflow = this.getWorkflow(workflowId);
    if (!workflow) throw new Error(`Workflow ${workflowId} not found`);

    if (workflow.status === WORKFLOW_STATUS.COMPLETED || workflow.status === WORKFLOW_STATUS.FAILED) {
      return workflow;
    }

    if (workflow.status === WORKFLOW_STATUS.AWAITING_APPROVAL) {
      return workflow;
    }

    workflow.status = WORKFLOW_STATUS.RUNNING;
    workflow.updatedAt = new Date().toISOString();

    // Find all queued tasks whose dependencies are fully completed
    const readyTasks = workflow.tasks.filter((task) => {
      if (task.status !== TASK_STATUS.QUEUED && task.status !== TASK_STATUS.NEEDS_REVISION) {
        return false;
      }
      return task.dependencies.every((depId) => {
        const depTask = workflow.tasks.find((t) => t.id === depId);
        return depTask && depTask.status === TASK_STATUS.COMPLETED;
      });
    });

    if (readyTasks.length === 0) {
      // Check if all tasks are complete
      const allComplete = workflow.tasks.every((t) => t.status === TASK_STATUS.COMPLETED);
      if (allComplete) {
        workflow.status = WORKFLOW_STATUS.COMPLETED;
        this.observability.emitEvent('workflow_completed', { workflowId });
      }
      return workflow;
    }

    // Execute ready tasks in parallel
    await Promise.all(readyTasks.map((task) => this.executeTask(workflow, task, options)));

    // Check if the workflow now hits a human approval gate
    const checkpointTask = workflow.tasks.find((t) => (
      t.status === TASK_STATUS.COMPLETED &&
      t.requiresApproval &&
      !t.approvalGranted
    ));

    if (checkpointTask) {
      workflow.status = WORKFLOW_STATUS.AWAITING_APPROVAL;
      workflow.currentCheckpoint = {
        taskId: checkpointTask.id,
        checkpointType: checkpointTask.requiresApproval,
        agent: checkpointTask.agent,
        title: checkpointTask.title,
        summary: checkpointTask.output?.summary || 'Review required before proceeding.',
      };
      this.observability.emitEvent('checkpoint_reached', {
        workflowId,
        checkpoint: workflow.currentCheckpoint,
      });
      return workflow;
    }

    // Check for QA or Security Review findings
    const reviewResult = await this.evaluateReviewLoops(workflow, options);
    if (reviewResult.needsRevision) {
      // Re-run with the updated repair tasks
      return this.runNextSteps(workflowId, options);
    }

    // Recursively proceed to the next topological level
    return this.runNextSteps(workflowId, options);
  }

  /**
   * Executes a single agent task using isolated context and records artifacts.
   */
  async executeTask(workflow, task, options = {}) {
    task.status = TASK_STATUS.RUNNING;
    task.progress = 25;
    this.observability.emitEvent('task_started', {
      workflowId: workflow.id,
      taskId: task.id,
      agent: task.agent,
      title: task.title,
    });

    try {
      const agent = this.workforce.getAgent(task.agent);

      // Build strictly isolated context for this specific agent role
      const context = this.contextManager.buildAgentContext(workflow.projectId, task.agent, {
        taskTitle: task.title,
        reviewFeedback: task.reviewFindings.length > 0 ? task.reviewFindings : null,
      });

      task.progress = 50;

      const output = await agent.execute({
        workflowId: workflow.id,
        taskId: task.id,
        taskTitle: task.title,
        context,
        options,
      });

      task.progress = 90;
      task.output = output;

      // Save all produced artifacts into the workspace context
      for (const artifact of output.artifacts || []) {
        this.contextManager.saveArtifact(workflow.projectId, {
          ...artifact,
          createdBy: task.agent,
          taskId: task.id,
        });
      }

      // Record any decisions into the workspace
      for (const decision of output.decisions || []) {
        this.contextManager.addDecision(workflow.projectId, decision);
      }

      task.status = TASK_STATUS.COMPLETED;
      task.progress = 100;

      this.observability.emitEvent('task_completed', {
        workflowId: workflow.id,
        taskId: task.id,
        agent: task.agent,
        summary: output.summary,
      });

      return task;
    } catch (error) {
      console.error(`[Orchestrator] Task ${task.id} (${task.agent}) failed:`, error);
      task.status = TASK_STATUS.FAILED;
      task.error = error.message;

      this.observability.emitEvent('task_failed', {
        workflowId: workflow.id,
        taskId: task.id,
        agent: task.agent,
        error: error.message,
      });

      throw error;
    }
  }

  /**
   * Inspects QA & Security outputs for review loops.
   * If defects or high vulnerabilities are detected, routes revisions back to engineers.
   */
  async evaluateReviewLoops(workflow, options = {}) {
    if (workflow.reviewLoopCount >= 2) {
      // Max 2 automated revision cycles to prevent infinite loops
      return { needsRevision: false };
    }

    const secTask = workflow.tasks.find((t) => t.agent === AGENT_ROLES.SECURITY_ENGINEER && t.status === TASK_STATUS.COMPLETED);
    const qaTask = workflow.tasks.find((t) => t.agent === AGENT_ROLES.QA_ENGINEER && t.status === TASK_STATUS.COMPLETED);

    let revisionRequired = false;
    const findings = [];

    if (secTask && secTask.output) {
      const highRisks = (secTask.output.risks || []).filter((r) => r.severity === 'high' || r.severity === 'critical');
      if (highRisks.length > 0) {
        revisionRequired = true;
        findings.push(...highRisks.map((r) => `[Security ${r.severity}] ${r.description}`));
      }
    }

    if (qaTask && qaTask.output && qaTask.output.status === 'failed') {
      revisionRequired = true;
      findings.push('[QA Defect] Verification tests failed on implementation.');
    }

    if (revisionRequired && findings.length > 0) {
      workflow.reviewLoopCount += 1;

      // Locate Backend and Frontend tasks to mark for revision
      const beTask = workflow.tasks.find((t) => t.agent === AGENT_ROLES.BACKEND_ENGINEER);
      if (beTask) {
        beTask.status = TASK_STATUS.NEEDS_REVISION;
        beTask.reviewFindings = [...findings];
      }

      // Reset downstream tasks (Sec, QA, DevOps, Docs) to queued
      const downstreamAgents = [AGENT_ROLES.SECURITY_ENGINEER, AGENT_ROLES.QA_ENGINEER, AGENT_ROLES.DEVOPS_ENGINEER, AGENT_ROLES.DOCUMENTATION_ENGINEER];
      for (const t of workflow.tasks) {
        if (downstreamAgents.includes(t.agent)) {
          t.status = TASK_STATUS.QUEUED;
          t.progress = 0;
        }
      }

      this.observability.emitEvent('review_loop_triggered', {
        workflowId: workflow.id,
        iteration: workflow.reviewLoopCount,
        findings,
      });

      return { needsRevision: true, findings };
    }

    return { needsRevision: false };
  }

  /**
   * Human approval submission for a pending checkpoint.
   */
  async approveCheckpoint(workflowId, checkpointType, { approved = true, comments = '' } = {}) {
    const workflow = this.getWorkflow(workflowId);
    if (!workflow) throw new Error(`Workflow ${workflowId} not found`);

    if (workflow.status !== WORKFLOW_STATUS.AWAITING_APPROVAL || !workflow.currentCheckpoint) {
      throw new Error(`Workflow is not currently awaiting approval for "${checkpointType}"`);
    }

    const checkpointTask = workflow.tasks.find((t) => t.id === workflow.currentCheckpoint.taskId);
    if (!checkpointTask) throw new Error('Checkpoint task not found in workflow');

    if (!approved) {
      workflow.status = WORKFLOW_STATUS.FAILED;
      checkpointTask.status = TASK_STATUS.FAILED;
      checkpointTask.error = `Rejected by human reviewer: ${comments}`;
      this.observability.emitEvent('checkpoint_rejected', { workflowId, checkpointType, comments });
      return workflow;
    }

    checkpointTask.approvalGranted = true;
    checkpointTask.approvalComments = comments;
    checkpointTask.approvedAt = new Date().toISOString();

    workflow.currentCheckpoint = null;
    workflow.status = WORKFLOW_STATUS.RUNNING;

    this.observability.emitEvent('checkpoint_approved', { workflowId, checkpointType, comments });

    // Resume execution to the next topological steps
    return this.runNextSteps(workflowId);
  }

  /**
   * Returns real-time office presentation state for UI dashboard.
   */
  getOfficeFloorState(projectId) {
    const workflow = this.getWorkflowForProject(projectId);
    if (!workflow) {
      // Default idle state for all 9 agents
      return {
        hasActiveWorkflow: false,
        workflowStatus: 'idle',
        agents: Object.values(AGENT_METADATA).map((meta) => ({
          ...meta,
          status: 'idle',
          progress: 0,
          currentTask: 'Awaiting project dispatch',
        })),
        tasks: [],
      };
    }

    const agentStateMap = new Map();
    for (const meta of Object.values(AGENT_METADATA)) {
      agentStateMap.set(meta.role, {
        ...meta,
        status: 'idle',
        progress: 0,
        currentTask: 'Idle',
      });
    }

    for (const task of workflow.tasks) {
      const entry = agentStateMap.get(task.agent);
      if (entry) {
        entry.currentTask = task.title;
        entry.progress = task.progress;
        if (task.status === TASK_STATUS.RUNNING) entry.status = 'working';
        else if (task.status === TASK_STATUS.QUEUED) entry.status = 'queued';
        else if (task.status === TASK_STATUS.COMPLETED) entry.status = 'done';
        else if (task.status === TASK_STATUS.AWAITING_APPROVAL) entry.status = 'awaiting_approval';
        else if (task.status === TASK_STATUS.NEEDS_REVISION) entry.status = 'working';
        else if (task.status === TASK_STATUS.FAILED) entry.status = 'failed';
      }
    }

    return {
      hasActiveWorkflow: true,
      workflowId: workflow.id,
      workflowStatus: workflow.status,
      currentCheckpoint: workflow.currentCheckpoint,
      agents: [...agentStateMap.values()],
      tasks: workflow.tasks.map((t) => ({
        id: t.id,
        agent: AGENT_METADATA[t.agent]?.name || t.agent,
        role: t.agent,
        task: t.title,
        status: t.status,
        progress: t.progress,
        summary: t.output?.summary || null,
        requiresApproval: t.requiresApproval || null,
      })),
    };
  }
}
