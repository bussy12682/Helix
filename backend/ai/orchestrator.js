/**
 * HELIX AI Engineering Operating System — Workflow Orchestration Engine
 * Coordinates the 9 specialized agents through an explicit Directed Acyclic Graph (DAG),
 * human approval gates, automated review loops (QA & Security), and context isolation.
 */

import { randomUUID } from "node:crypto";
import { AGENT_ROLES, AGENT_METADATA } from "./contracts.js";

export const WORKFLOW_STATUS = {
  PENDING: "pending",
  RUNNING: "running",
  AWAITING_APPROVAL: "awaiting_approval",
  COMPLETED: "completed",
  FAILED: "failed",
  CANCELLED: "cancelled",
};

export const TASK_STATUS = {
  QUEUED: "queued",
  RUNNING: "running",
  AWAITING_APPROVAL: "awaiting_approval",
  COMPLETED: "completed",
  NEEDS_REVISION: "needs_revision",
  FAILED: "failed",
  CANCELLED: "cancelled",
};

const TERMINAL_STATUSES = new Set([
  WORKFLOW_STATUS.COMPLETED,
  WORKFLOW_STATUS.FAILED,
  WORKFLOW_STATUS.CANCELLED,
]);
const STREAM_EMIT_INTERVAL_MS = 250;

export class WorkflowStateError extends Error {
  constructor(message, code = "INVALID_WORKFLOW_STATE") {
    super(message);
    this.name = "WorkflowStateError";
    this.code = code;
  }
}

export class Orchestrator {
  constructor({ workforce, contextManager, observability, toolRegistry, storage }) {
    this.workforce = workforce;
    this.contextManager = contextManager;
    this.observability = observability;
    this.toolRegistry = toolRegistry;
    this.storage = storage ?? null;

    this.workflows = new Map();
    // Single-flight guard: at most one execution loop per workflow.
    this.activeRuns = new Map();
    this.abortControllers = new Map();
  }

  /**
   * Plugs in a persistence adapter ({ saveWorkflow(workflow) }) and restores saved workflows.
   * Workflows interrupted mid-run (process restart) are re-queued so they can be resumed.
   */
  attachStorage(storage, savedWorkflows = []) {
    this.storage = storage;
    for (const workflow of savedWorkflows) {
      if (!workflow?.id) continue;
      if (
        workflow.status === WORKFLOW_STATUS.RUNNING ||
        workflow.status === WORKFLOW_STATUS.PENDING
      ) {
        for (const task of workflow.tasks) {
          if (task.status === TASK_STATUS.RUNNING) {
            task.status = TASK_STATUS.QUEUED;
            task.progress = 0;
          }
        }
        workflow.status = WORKFLOW_STATUS.PENDING;
        workflow.interrupted = true;
      }
      this.workflows.set(workflow.id, workflow);
    }
  }

  /**
   * Restarts workflows that were interrupted by a process restart.
   */
  resumeInterrupted() {
    const resumed = [];
    for (const workflow of this.workflows.values()) {
      if (workflow.interrupted) {
        delete workflow.interrupted;
        resumed.push(workflow.id);
        this.runNextSteps(workflow.id).catch((error) => {
          console.error(`[Orchestrator] Resume of ${workflow.id} failed:`, error);
        });
      }
    }
    return resumed;
  }

  persist(workflow) {
    if (workflow.removed || this.workflows.get(workflow.id) !== workflow) return;
    workflow.updatedAt = new Date().toISOString();
    const completed = workflow.tasks.filter((t) => t.status === TASK_STATUS.COMPLETED).length;
    workflow.progress = Math.round((completed / workflow.tasks.length) * 100);
    this.storage?.saveWorkflow?.(workflow);
  }

  emit(type, workflow, payload = {}) {
    this.observability.emitEvent(type, {
      workflowId: workflow.id,
      projectId: workflow.projectId,
      ...payload,
    });
  }

  /**
   * Initializes a coordinated 9-agent engineering workflow for a project.
   */
  async createWorkflow(projectId, projectData = {}) {
    const existing = this.getWorkflowForProject(projectId);
    if (existing && !TERMINAL_STATUSES.has(existing.status)) {
      throw new WorkflowStateError(
        "A workflow is already active for this project.",
        "WORKFLOW_ALREADY_ACTIVE",
      );
    }
    const workflowId = `wf_${randomUUID()}`;

    // Initialize isolated workspace context
    this.contextManager.getOrCreateWorkspace(projectId, projectData);

    const initialTasks = [
      {
        id: `task_${randomUUID()}`,
        agent: AGENT_ROLES.PRODUCT_MANAGER,
        title: "Define Product Requirements & User Stories",
        status: TASK_STATUS.QUEUED,
        dependencies: [],
        progress: 0,
        output: null,
        reviewFindings: [],
        attempts: 0,
      },
      {
        id: `task_${randomUUID()}`,
        agent: AGENT_ROLES.SYSTEM_ARCHITECT,
        title: "Formulate Architecture, Tech Stack & API Specs",
        status: TASK_STATUS.QUEUED,
        dependencies: [0], // indexes to be resolved to IDs
        progress: 0,
        output: null,
        requiresApproval: "architecture_approval",
        reviewFindings: [],
        attempts: 0,
      },
      {
        id: `task_${randomUUID()}`,
        agent: AGENT_ROLES.DATABASE_ENGINEER,
        title: "Model Relational Schemas, Constraints & Indexes",
        status: TASK_STATUS.QUEUED,
        dependencies: [1],
        progress: 0,
        output: null,
        reviewFindings: [],
        attempts: 0,
      },
      {
        id: `task_${randomUUID()}`,
        agent: AGENT_ROLES.BACKEND_ENGINEER,
        title: "Build API Endpoints, Business Logic & Security",
        status: TASK_STATUS.QUEUED,
        dependencies: [1, 2],
        progress: 0,
        output: null,
        reviewFindings: [],
        attempts: 0,
      },
      {
        id: `task_${randomUUID()}`,
        agent: AGENT_ROLES.FRONTEND_ENGINEER,
        title: "Implement UI Views, Components & State Management",
        status: TASK_STATUS.QUEUED,
        dependencies: [1], // can run parallel with database & backend
        progress: 0,
        output: null,
        reviewFindings: [],
        attempts: 0,
      },
      {
        id: `task_${randomUUID()}`,
        agent: AGENT_ROLES.SECURITY_ENGINEER,
        title: "Execute Threat Modeling & Security Review",
        status: TASK_STATUS.QUEUED,
        dependencies: [3],
        progress: 0,
        output: null,
        reviewFindings: [],
        attempts: 0,
      },
      {
        id: `task_${randomUUID()}`,
        agent: AGENT_ROLES.QA_ENGINEER,
        title: "Run QA Test Suite & Requirement Verification",
        status: TASK_STATUS.QUEUED,
        dependencies: [3, 4],
        progress: 0,
        output: null,
        reviewFindings: [],
        attempts: 0,
      },
      {
        id: `task_${randomUUID()}`,
        agent: AGENT_ROLES.DEVOPS_ENGINEER,
        title: "Generate Containerization & CI/CD Pipelines",
        status: TASK_STATUS.QUEUED,
        dependencies: [5, 6],
        progress: 0,
        output: null,
        requiresApproval: "release_approval",
        reviewFindings: [],
        attempts: 0,
      },
      {
        id: `task_${randomUUID()}`,
        agent: AGENT_ROLES.DOCUMENTATION_ENGINEER,
        title: "Synthesize README & Developer Documentation",
        status: TASK_STATUS.QUEUED,
        dependencies: [7],
        progress: 0,
        output: null,
        reviewFindings: [],
        attempts: 0,
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
      progress: 0,
      error: null,
      tasks: resolvedTasks,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    this.workflows.set(workflowId, workflow);
    this.persist(workflow);
    this.emit("workflow_created", workflow);

    return workflow;
  }

  getWorkflow(workflowId) {
    return this.workflows.get(workflowId) || null;
  }

  getWorkflowForProject(projectId) {
    let latest = null;
    for (const wf of this.workflows.values()) {
      if (wf.projectId === projectId && (!latest || wf.createdAt >= latest.createdAt)) latest = wf;
    }
    return latest;
  }

  listWorkflowsForProject(projectId) {
    return [...this.workflows.values()]
      .filter((wf) => wf.projectId === projectId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  removeProject(projectId) {
    for (const [id, wf] of this.workflows) {
      if (wf.projectId === projectId) {
        wf.removed = true;
        wf.status = WORKFLOW_STATUS.CANCELLED;
        this.abortControllers.get(id)?.abort();
        this.workflows.delete(id);
      }
    }
    this.contextManager.clearWorkspace(projectId);
  }

  /**
   * Evaluates the task DAG and executes every task whose prerequisites are satisfied,
   * level by level, running independent tasks concurrently. Stops at human approval
   * gates, failures, cancellation, or completion. Concurrent callers share one run.
   */
  runNextSteps(workflowId, options = {}) {
    const workflow = this.getWorkflow(workflowId);
    if (!workflow) return Promise.reject(new Error(`Workflow ${workflowId} not found`));

    const active = this.activeRuns.get(workflowId);
    if (active) return active;

    const controller = new AbortController();
    this.abortControllers.set(workflowId, controller);
    const run = this.runLoop(workflow, { ...options, signal: controller.signal }).finally(() => {
      this.activeRuns.delete(workflowId);
      this.abortControllers.delete(workflowId);
    });
    this.activeRuns.set(workflowId, run);
    return run;
  }

  async runLoop(workflow, options) {
    while (true) {
      if (
        TERMINAL_STATUSES.has(workflow.status) ||
        workflow.status === WORKFLOW_STATUS.AWAITING_APPROVAL
      ) {
        return workflow;
      }

      if (workflow.status !== WORKFLOW_STATUS.RUNNING) {
        workflow.status = WORKFLOW_STATUS.RUNNING;
        this.persist(workflow);
        this.emit("workflow_status", workflow, { status: workflow.status });
      }

      if (this.openPendingCheckpoint(workflow)) return workflow;

      const readyTasks = workflow.tasks.filter((task) => {
        if (task.status !== TASK_STATUS.QUEUED && task.status !== TASK_STATUS.NEEDS_REVISION)
          return false;
        return task.dependencies.every((depId) => {
          const depTask = workflow.tasks.find((t) => t.id === depId);
          return (
            depTask &&
            depTask.status === TASK_STATUS.COMPLETED &&
            (!depTask.requiresApproval || depTask.approvalGranted)
          );
        });
      });

      if (readyTasks.length === 0) {
        if (workflow.tasks.every((t) => t.status === TASK_STATUS.COMPLETED)) {
          workflow.status = WORKFLOW_STATUS.COMPLETED;
          workflow.completedAt = new Date().toISOString();
          this.persist(workflow);
          this.emit("workflow_completed", workflow);
        } else {
          this.failWorkflow(workflow, "No runnable tasks remain; the task graph is blocked.");
        }
        return workflow;
      }

      const results = await Promise.allSettled(
        readyTasks.map((task) => this.executeTask(workflow, task, options)),
      );

      if (workflow.status === WORKFLOW_STATUS.CANCELLED) return workflow;

      const failure = results.find((r) => r.status === "rejected");
      if (failure) {
        this.failWorkflow(workflow, failure.reason?.message || "Agent task failed.");
        return workflow;
      }

      if (this.openPendingCheckpoint(workflow)) return workflow;

      await this.evaluateReviewLoops(workflow, options);
      this.persist(workflow);
    }
  }

  /**
   * Pauses at the first completed-but-unapproved gate (also after retry/resume of a cancelled run).
   */
  openPendingCheckpoint(workflow) {
    const checkpointTask = workflow.tasks.find(
      (t) => t.status === TASK_STATUS.COMPLETED && t.requiresApproval && !t.approvalGranted,
    );
    if (!checkpointTask) return false;
    workflow.status = WORKFLOW_STATUS.AWAITING_APPROVAL;
    workflow.currentCheckpoint = {
      taskId: checkpointTask.id,
      checkpointType: checkpointTask.requiresApproval,
      agent: checkpointTask.agent,
      title: checkpointTask.title,
      summary: checkpointTask.output?.summary || "Review required before proceeding.",
    };
    this.persist(workflow);
    this.emit("checkpoint_reached", workflow, { checkpoint: workflow.currentCheckpoint });
    return true;
  }

  failWorkflow(workflow, message) {
    workflow.status = WORKFLOW_STATUS.FAILED;
    workflow.error = message;
    this.persist(workflow);
    this.emit("workflow_failed", workflow, { error: message });
  }

  /**
   * Executes a single agent task using isolated context and records artifacts.
   */
  async executeTask(workflow, task, options = {}) {
    task.status = TASK_STATUS.RUNNING;
    task.progress = 10;
    task.error = null;
    task.attempts = (task.attempts ?? 0) + 1;
    task.startedAt = new Date().toISOString();
    task.streamedChars = 0;
    this.persist(workflow);
    this.emit("task_started", workflow, { taskId: task.id, agent: task.agent, title: task.title });

    let pendingDelta = "";
    let lastEmit = 0;
    const flushStream = () => {
      if (!pendingDelta) return;
      this.emit("task_stream", workflow, {
        taskId: task.id,
        agent: task.agent,
        delta: pendingDelta,
        chars: task.streamedChars,
        progress: task.progress,
      });
      pendingDelta = "";
      lastEmit = Date.now();
    };

    try {
      const agent = this.workforce.getAgent(task.agent);
      if (!agent) throw new Error(`No agent registered for role "${task.agent}"`);

      const context = this.contextManager.buildAgentContext(workflow.projectId, task.agent, {
        taskTitle: task.title,
        reviewFeedback: task.reviewFindings.length > 0 ? task.reviewFindings : null,
      });
      if (task.reviewFindings.length > 0) context.reviewFeedback = task.reviewFindings;

      task.progress = 25;

      const output = await agent.execute({
        workflowId: workflow.id,
        projectId: workflow.projectId,
        taskId: task.id,
        taskTitle: task.title,
        context,
        options: {
          ...options,
          onToken: (delta) => {
            task.streamedChars += delta.length;
            // Approaches 90% asymptotically while tokens arrive.
            task.progress = Math.min(
              89,
              25 + Math.round(64 * (1 - Math.exp(-task.streamedChars / 6000))),
            );
            pendingDelta += delta;
            if (Date.now() - lastEmit >= STREAM_EMIT_INTERVAL_MS) flushStream();
          },
        },
        onMeta: (meta) => {
          task.provider = meta.provider;
          task.model = meta.model;
          task.usage = meta.usage ?? null;
          task.simulated = meta.provider === "mock";
          task.generationAttempts = meta.attempts;
        },
      });
      flushStream();

      if (workflow.status === WORKFLOW_STATUS.CANCELLED) {
        task.status = TASK_STATUS.CANCELLED;
        task.progress = 0;
        return task;
      }

      task.progress = 90;
      task.output = output;

      for (const artifact of output.artifacts || []) {
        this.contextManager.saveArtifact(workflow.projectId, {
          ...artifact,
          createdBy: task.agent,
          taskId: task.id,
        });
      }

      for (const decision of output.decisions || []) {
        this.contextManager.addDecision(workflow.projectId, decision);
      }

      if (task.reviewFindings.length > 0) {
        task.addressedFindings = [...(task.addressedFindings ?? []), ...task.reviewFindings];
        task.reviewFindings = [];
      }
      task.status = TASK_STATUS.COMPLETED;
      task.progress = 100;
      task.completedAt = new Date().toISOString();
      task.durationMs = Date.parse(task.completedAt) - Date.parse(task.startedAt);
      this.persist(workflow);

      this.emit("task_completed", workflow, {
        taskId: task.id,
        agent: task.agent,
        summary: output.summary,
        provider: task.provider,
        model: task.model,
      });

      return task;
    } catch (error) {
      flushStream();
      if (workflow.status === WORKFLOW_STATUS.CANCELLED || error.name === "AbortError") {
        task.status = TASK_STATUS.CANCELLED;
        task.progress = 0;
        this.persist(workflow);
        return task;
      }
      console.error(`[Orchestrator] Task ${task.id} (${task.agent}) failed:`, error.message);
      task.status = TASK_STATUS.FAILED;
      task.error = error.message;
      this.persist(workflow);

      this.emit("task_failed", workflow, {
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

    const secTask = workflow.tasks.find(
      (t) => t.agent === AGENT_ROLES.SECURITY_ENGINEER && t.status === TASK_STATUS.COMPLETED,
    );
    const qaTask = workflow.tasks.find(
      (t) => t.agent === AGENT_ROLES.QA_ENGINEER && t.status === TASK_STATUS.COMPLETED,
    );

    let revisionRequired = false;
    const findings = [];

    if (secTask && secTask.output) {
      const highRisks = (secTask.output.risks || []).filter(
        (r) => r.severity === "high" || r.severity === "critical",
      );
      if (highRisks.length > 0) {
        revisionRequired = true;
        findings.push(...highRisks.map((r) => `[Security ${r.severity}] ${r.description}`));
      }
    }

    if (qaTask && qaTask.output && qaTask.output.status === "failed") {
      revisionRequired = true;
      findings.push("[QA Defect] Verification tests failed on implementation.");
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
      const downstreamAgents = [
        AGENT_ROLES.SECURITY_ENGINEER,
        AGENT_ROLES.QA_ENGINEER,
        AGENT_ROLES.DEVOPS_ENGINEER,
        AGENT_ROLES.DOCUMENTATION_ENGINEER,
      ];
      for (const t of workflow.tasks) {
        if (downstreamAgents.includes(t.agent)) {
          t.status = TASK_STATUS.QUEUED;
          t.progress = 0;
        }
      }

      this.emit("review_loop_triggered", workflow, {
        iteration: workflow.reviewLoopCount,
        findings,
      });

      return { needsRevision: true, findings };
    }

    return { needsRevision: false };
  }

  /**
   * Human decision on a pending checkpoint:
   *  - approved: true            -> gate opens and execution resumes
   *  - approved: false           -> workflow is rejected (failed, retryable)
   *  - approved: false, revise   -> the gated task re-runs with the reviewer's comments as feedback
   * Returns the run promise (resolves at the next gate / completion); callers that must
   * respond quickly can use `decideCheckpoint` instead.
   */
  async approveCheckpoint(workflowId, checkpointType, decision = {}) {
    const workflow = this.decideCheckpoint(workflowId, checkpointType, decision);
    if (workflow.status !== WORKFLOW_STATUS.RUNNING) return workflow;
    return this.runNextSteps(workflowId);
  }

  /**
   * Applies a checkpoint decision synchronously without waiting for execution.
   */
  decideCheckpoint(
    workflowId,
    checkpointType,
    { approved = true, comments = "", revise = false } = {},
  ) {
    const workflow = this.getWorkflow(workflowId);
    if (!workflow)
      throw new WorkflowStateError(`Workflow ${workflowId} not found`, "WORKFLOW_NOT_FOUND");

    if (workflow.status !== WORKFLOW_STATUS.AWAITING_APPROVAL || !workflow.currentCheckpoint) {
      throw new WorkflowStateError(
        `Workflow is not currently awaiting approval for "${checkpointType}"`,
      );
    }
    if (checkpointType && workflow.currentCheckpoint.checkpointType !== checkpointType) {
      throw new WorkflowStateError(
        `Workflow is awaiting "${workflow.currentCheckpoint.checkpointType}", not "${checkpointType}"`,
      );
    }

    const checkpointTask = workflow.tasks.find((t) => t.id === workflow.currentCheckpoint.taskId);
    if (!checkpointTask) throw new WorkflowStateError("Checkpoint task not found in workflow");
    const type = workflow.currentCheckpoint.checkpointType;

    if (!approved && revise) {
      checkpointTask.status = TASK_STATUS.NEEDS_REVISION;
      checkpointTask.progress = 0;
      checkpointTask.reviewFindings = [
        `[Human reviewer] ${comments || "Revise and improve this output."}`,
      ];
      workflow.currentCheckpoint = null;
      workflow.status = WORKFLOW_STATUS.RUNNING;
      this.persist(workflow);
      this.emit("checkpoint_revision_requested", workflow, { checkpointType: type, comments });
      this.runNextSteps(workflowId).catch((error) =>
        console.error("[Orchestrator] Revision run failed:", error),
      );
      return workflow;
    }

    if (!approved) {
      workflow.status = WORKFLOW_STATUS.FAILED;
      workflow.error = `Rejected by human reviewer${comments ? `: ${comments}` : ""}`;
      workflow.currentCheckpoint = null;
      checkpointTask.status = TASK_STATUS.FAILED;
      checkpointTask.error = workflow.error;
      this.persist(workflow);
      this.emit("checkpoint_rejected", workflow, { checkpointType: type, comments });
      return workflow;
    }

    checkpointTask.approvalGranted = true;
    checkpointTask.approvalComments = comments;
    checkpointTask.approvedAt = new Date().toISOString();

    workflow.currentCheckpoint = null;
    workflow.status = WORKFLOW_STATUS.RUNNING;
    this.persist(workflow);
    this.emit("checkpoint_approved", workflow, { checkpointType: type, comments });
    return workflow;
  }

  /**
   * Re-queues failed/cancelled tasks of a failed or cancelled workflow and resumes execution.
   * Completed work and artifacts are preserved.
   */
  retryWorkflow(workflowId) {
    const workflow = this.getWorkflow(workflowId);
    if (!workflow)
      throw new WorkflowStateError(`Workflow ${workflowId} not found`, "WORKFLOW_NOT_FOUND");
    if (
      workflow.status !== WORKFLOW_STATUS.FAILED &&
      workflow.status !== WORKFLOW_STATUS.CANCELLED
    ) {
      throw new WorkflowStateError(
        `Only failed or cancelled workflows can be retried (status: ${workflow.status}).`,
      );
    }
    const previousRun = this.activeRuns.get(workflowId);
    if (previousRun) {
      // A cancelled run is still unwinding; requeue only after it settles so it cannot clobber the retry.
      const run = previousRun.catch(() => {}).then(() => this.retryWorkflow(workflowId).run);
      run.catch((error) => console.error("[Orchestrator] Retry run failed:", error));
      return { workflow, run };
    }
    for (const task of workflow.tasks) {
      if ([TASK_STATUS.FAILED, TASK_STATUS.CANCELLED, TASK_STATUS.RUNNING].includes(task.status)) {
        task.status = TASK_STATUS.QUEUED;
        task.progress = 0;
        task.error = null;
      }
    }
    workflow.error = null;
    workflow.status = WORKFLOW_STATUS.PENDING;
    this.persist(workflow);
    this.emit("workflow_retried", workflow);
    const run = this.runNextSteps(workflowId);
    run.catch((error) => console.error("[Orchestrator] Retry run failed:", error));
    return { workflow, run };
  }

  /**
   * Cancels an active workflow and aborts in-flight model calls.
   */
  cancelWorkflow(workflowId, reason = "Cancelled by user") {
    const workflow = this.getWorkflow(workflowId);
    if (!workflow)
      throw new WorkflowStateError(`Workflow ${workflowId} not found`, "WORKFLOW_NOT_FOUND");
    if (TERMINAL_STATUSES.has(workflow.status)) {
      throw new WorkflowStateError(`Workflow is already ${workflow.status}.`);
    }
    workflow.status = WORKFLOW_STATUS.CANCELLED;
    workflow.error = reason;
    workflow.currentCheckpoint = null;
    for (const task of workflow.tasks) {
      if (task.status === TASK_STATUS.RUNNING) {
        task.status = TASK_STATUS.CANCELLED;
        task.progress = 0;
      }
    }
    this.abortControllers.get(workflowId)?.abort();
    this.persist(workflow);
    this.emit("workflow_cancelled", workflow, { reason });
    return workflow;
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
        workflowStatus: "idle",
        agents: Object.values(AGENT_METADATA).map((meta) => ({
          ...meta,
          status: "idle",
          progress: 0,
          currentTask: "Awaiting project dispatch",
        })),
        tasks: [],
      };
    }

    const agentStateMap = new Map();
    for (const meta of Object.values(AGENT_METADATA)) {
      agentStateMap.set(meta.role, {
        ...meta,
        status: "idle",
        progress: 0,
        currentTask: "Idle",
      });
    }

    for (const task of workflow.tasks) {
      const entry = agentStateMap.get(task.agent);
      if (entry) {
        entry.currentTask = task.title;
        entry.progress = task.progress;
        if (task.status === TASK_STATUS.RUNNING) entry.status = "working";
        else if (task.status === TASK_STATUS.QUEUED) entry.status = "queued";
        else if (task.status === TASK_STATUS.COMPLETED) entry.status = "done";
        else if (task.status === TASK_STATUS.AWAITING_APPROVAL) entry.status = "awaiting_approval";
        else if (task.status === TASK_STATUS.NEEDS_REVISION) entry.status = "working";
        else if (task.status === TASK_STATUS.FAILED) entry.status = "failed";
        else if (task.status === TASK_STATUS.CANCELLED) entry.status = "cancelled";
        if (task.provider) {
          entry.provider = task.provider;
          entry.model = task.model;
          entry.simulated = task.provider === "mock";
        }
      }
    }

    return {
      hasActiveWorkflow: true,
      workflowId: workflow.id,
      workflowStatus: workflow.status,
      workflowError: workflow.error ?? null,
      progress: workflow.progress ?? 0,
      reviewLoopCount: workflow.reviewLoopCount,
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
        approvalGranted: Boolean(t.approvalGranted),
        error: t.error || null,
        provider: t.provider || null,
        model: t.model || null,
        simulated: t.provider === "mock",
        attempts: t.attempts ?? 0,
        durationMs: t.durationMs ?? null,
        risks: t.output?.risks ?? [],
        reviewFindings: t.reviewFindings ?? [],
      })),
    };
  }
}
