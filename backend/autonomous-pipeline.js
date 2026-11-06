/**
 * HELIX AI Engineering Operating System — Autonomous Pipeline
 * Runs the full autonomous engineering loop for a project:
 *
 *   1. PLAN + GENERATE — the nine agents collaborate through the orchestration DAG
 *      (approval gates are auto-approved in this mode and recorded as such);
 *   2. MATERIALIZE — artifacts become real files on disk;
 *   3. INSTALL / TEST / BUILD — real sandboxed jobs against the real files;
 *   4. REPAIR — when a step fails, the configured provider diagnoses the captured
 *      runtime output, patches the files, and the SAME command is rerun; the
 *      repair is reported verified only if the rerun actually exits 0.
 *
 * Every step records the real job outcome; nothing is inferred. The pipeline is
 * tracked in memory with events, and a bounded run summary is persisted on the
 * project so history survives restarts.
 */

import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";

import { WORKFLOW_STATUS } from "./ai/orchestrator.js";

const MAX_RUNS_PER_PROJECT = 10;
const MAX_APPROVAL_ROUNDS = 6;
const STEP_TIMEOUT_MS = 300000;

export class AutonomousPipeline extends EventEmitter {
  constructor({
    ai,
    workspaceService,
    executionService,
    applicationService,
    repairService,
    saveRun,
    persistence = null,
  }) {
    super();
    this.setMaxListeners(0);
    this.ai = ai;
    this.workspaceService = workspaceService;
    this.executionService = executionService;
    this.applicationService = applicationService;
    this.repairService = repairService;
    this.saveRun = saveRun;
    // Optional durable-record adapter: { saveRunRecord, deleteRunRecord }.
    this.persistence = persistence;
    this.runs = new Map();
    this.activeRuns = new Map();
  }

  /**
   * Loads durable run records from a previous process life so run history and
   * step details remain queryable across restarts.
   */
  hydrateRuns(records = []) {
    for (const record of records) {
      if (!record?.id || this.runs.has(record.id)) continue;
      this.runs.set(record.id, {
        ...record,
        steps: record.steps?.map((step) => ({ ...step })) ?? [],
      });
    }
    return this.runs.size;
  }

  /**
   * Finalizes runs that were still running when the previous process died.
   * Resuming half-finished pipelines automatically would repeat side effects,
   * so the honest outcome is "interrupted" with a pointer to restart manually.
   */
  recoverInterrupted() {
    let interrupted = 0;
    for (const run of this.runs.values()) {
      if (run.status !== "running") continue;
      run.status = "interrupted";
      run.error = "interrupted by backend restart";
      run.finishedAt = new Date().toISOString();
      this.persistRun(run);
      interrupted += 1;
    }
    return interrupted;
  }

  emitPipeline(type, run, extra = {}) {
    this.emit("event", {
      id: randomUUID(),
      type,
      timestamp: new Date().toISOString(),
      projectId: run.projectId,
      payload: { runId: run.id, status: run.status, ...extra },
    });
  }

  toPublicRun(run) {
    return {
      id: run.id,
      projectId: run.projectId,
      status: run.status,
      steps: run.steps.map((step) => ({ ...step })),
      startedAt: run.startedAt,
      finishedAt: run.finishedAt ?? null,
      error: run.error ?? null,
      verified: run.steps.find((step) => step.kind === "test")?.verified ?? null,
    };
  }

  listRuns(projectId) {
    return [...this.runs.values()]
      .filter((run) => run.projectId === projectId)
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
      .slice(0, MAX_RUNS_PER_PROJECT)
      .map((run) => this.toPublicRun(run));
  }

  getRun(projectId, runId) {
    const run = this.runs.get(runId);
    return run && run.projectId === projectId ? this.toPublicRun(run) : null;
  }

  /**
   * Starts an autonomous run in the background and returns the running record.
   */
  start({ project, options = {} }) {
    const existing = [...this.runs.values()].find(
      (run) => run.projectId === project.id && run.status === "running",
    );
    if (existing) {
      throw Object.assign(new Error("An autonomous run is already in progress for this project"), {
        status: 409,
      });
    }
    const run = {
      id: `run_${randomUUID()}`,
      projectId: project.id,
      status: "running",
      steps: [],
      startedAt: new Date().toISOString(),
      options: {
        regenerate: options.regenerate !== false,
        install: options.install !== false,
        test: options.test !== false,
        build: options.build !== false,
        repairRounds: Math.max(0, Math.min(3, Number(options.repairRounds ?? 2))),
      },
    };
    this.runs.set(run.id, run);
    this.trimRuns(run.projectId);
    const execution = this.executeRun(run, project).catch((error) => {
      run.status = "failed";
      run.error = error.message;
      run.finishedAt = new Date().toISOString();
      this.emitPipeline("pipeline_failed", run, { error: error.message });
      this.persistRun(run);
    });
    this.activeRuns.set(
      run.id,
      execution.finally(() => this.activeRuns.delete(run.id)),
    );
    this.persistRun(run);
    this.emitPipeline("pipeline_started", run);
    return this.toPublicRun(run);
  }

  /** Keeps the newest MAX_RUNS_PER_PROJECT finished runs per project (live map + durable records). */
  trimRuns(projectId) {
    const history = [...this.runs.values()]
      .filter((candidate) => candidate.projectId === projectId && candidate.status !== "running")
      .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
    for (const stale of history.slice(
      0,
      Math.max(0, history.length - (MAX_RUNS_PER_PROJECT - 1)),
    )) {
      this.runs.delete(stale.id);
      this.persistence?.deleteRunRecord?.(stale.id);
    }
  }

  toDurableRun(run) {
    return {
      ...this.toPublicRun(run),
      options: { ...run.options },
      steps: run.steps.map((step) => ({
        kind: step.kind,
        title: step.title,
        status: step.status,
        startedAt: step.startedAt ?? null,
        finishedAt: step.finishedAt ?? null,
        verified: step.verified ?? null,
        jobId: step.jobId ?? null,
        detail: step.detail ?? null,
        error: step.error ?? null,
        repairRounds: step.repairRounds ?? null,
      })),
    };
  }

  persistRun(run) {
    if (this.saveRun)
      this.saveRun(run.projectId, {
        id: run.id,
        status: run.status,
        startedAt: run.startedAt,
        finishedAt: run.finishedAt ?? null,
        error: run.error ?? null,
        steps: run.steps.map((step) => ({
          kind: step.kind,
          title: step.title,
          status: step.status,
          verified: step.verified ?? null,
          jobId: step.jobId ?? null,
        })),
      });
    try {
      this.persistence?.saveRunRecord?.(this.toDurableRun(run));
    } catch {
      // Durability must never break the live pipeline; the next transition retries.
    }
  }

  beginStep(run, kind, title) {
    const step = { kind, title, status: "running", startedAt: new Date().toISOString() };
    run.steps.push(step);
    this.emitPipeline("pipeline_step", run, { step });
    return step;
  }

  finishStep(run, step, { status, jobId = null, verified = null, detail = null, error = null }) {
    step.status = status;
    step.finishedAt = new Date().toISOString();
    step.jobId = jobId;
    if (verified !== null) step.verified = verified;
    if (detail) step.detail = detail;
    if (error) step.error = error;
    this.emitPipeline("pipeline_step", run, { step });
    // Step transitions are durable so a mid-run crash leaves an honest trail.
    this.persistRun(run);
  }

  /** Waits for a started job, bounded by STEP_TIMEOUT_MS. */
  async awaitJob(job) {
    const bounded = Promise.race([
      job.completion,
      new Promise((_, reject) => {
        const timer = setTimeout(
          () => reject(new Error(`Step exceeded ${STEP_TIMEOUT_MS}ms`)),
          STEP_TIMEOUT_MS,
        );
        timer.unref?.();
      }),
    ]);
    const result = await bounded;
    return { job, result };
  }

  /**
   * Runs the generation workflow through the DAG, auto-approving human gates
   * (recorded on the checkpoint decision) until the workflow completes.
   */
  async runGeneration(run, project) {
    const step = this.beginStep(
      run,
      "generate",
      "Nine-agent generation through the orchestration DAG",
    );
    let workflow;
    try {
      workflow = await this.ai.orchestrator.createWorkflow(project.id, {
        name: project.name,
        description: project.description,
        keyFeatures: project.keyFeatures,
        techStack: project.techStack,
      });
    } catch (error) {
      this.finishStep(run, step, { status: "skipped", detail: error.message });
      return null;
    }
    workflow = await this.ai.orchestrator.runNextSteps(workflow.id);
    let rounds = 0;
    while (workflow.status === WORKFLOW_STATUS.AWAITING_APPROVAL && rounds < MAX_APPROVAL_ROUNDS) {
      rounds += 1;
      workflow = await this.ai.orchestrator.approveCheckpoint(
        workflow.id,
        workflow.currentCheckpoint.checkpointType,
        {
          approved: true,
          comments: "Auto-approved by the autonomous pipeline",
        },
      );
    }
    if (workflow.status !== WORKFLOW_STATUS.COMPLETED) {
      this.finishStep(run, step, {
        status: "failed",
        error: workflow.error ?? `Workflow ended with status ${workflow.status}`,
        detail: { workflowId: workflow.id, autoApprovals: rounds },
      });
      return workflow;
    }
    this.finishStep(run, step, {
      status: "completed",
      detail: { workflowId: workflow.id, tasks: workflow.tasks.length, autoApprovals: rounds },
    });
    return workflow;
  }

  async executeRun(run, project) {
    // 1. Generation (skipped when files already exist and regeneration is off).
    const hasFiles = this.workspaceService.list(project.id).length > 0;
    let workflow = null;
    if (!hasFiles || run.options.regenerate) {
      workflow = await this.runGeneration(run, project);
      if (workflow && workflow.status !== WORKFLOW_STATUS.COMPLETED) {
        run.status = "failed";
        run.error = `Generation failed: ${workflow.error ?? workflow.status}`;
        run.finishedAt = new Date().toISOString();
        this.emitPipeline("pipeline_failed", run, { error: run.error });
        this.persistRun(run);
        return;
      }
    }

    // 2. Materialize artifacts to the real workspace.
    const materializeStep = this.beginStep(
      run,
      "materialize",
      "Write artifacts to the sandbox workspace",
    );
    try {
      const root = await this.workspaceService.materialize(project.id);
      const files = this.workspaceService.list(project.id);
      this.finishStep(run, materializeStep, {
        status: "completed",
        detail: { root, fileCount: files.length },
      });
    } catch (error) {
      this.finishStep(run, materializeStep, { status: "failed", error: error.message });
      throw error;
    }

    // 3. Install (when a package.json exists).
    const { packageJson } = await this.applicationService.readPackage(project.id);
    const testCommand = packageJson?.scripts?.test ? ["npm", "test"] : null;
    const buildCommand = packageJson?.scripts?.build ? ["npm", "run", "build"] : null;

    if (run.options.install && packageJson) {
      const step = this.beginStep(
        run,
        "install",
        "Install dependencies (network enabled for this job)",
      );
      try {
        const job = await this.applicationService.install(project.id);
        const { result } = await this.awaitJob(job);
        this.finishStep(run, step, {
          status: job.status === "completed" ? "completed" : "failed",
          jobId: job.id,
          detail: {
            exitCode: result.exitCode ?? null,
            stderr: String(result.stderr ?? "").slice(-500),
          },
        });
        if (job.status !== "completed") {
          await this.repairStep(
            run,
            project,
            ["npm", "install", "--no-audit", "--no-fund"],
            "install",
          );
        }
      } catch (error) {
        this.finishStep(run, step, { status: "failed", error: error.message });
      }
    }

    // 4. Tests.
    if (run.options.test && testCommand) {
      const step = this.beginStep(run, "test", "Run the generated test suite in the sandbox");
      const job = this.executionService.start(project.id, {
        command: testCommand,
        kind: "test",
        timeoutMs: 120000,
        testSuiteName: "Autonomous pipeline tests",
      });
      const { result } = await this.awaitJob(job);
      this.finishStep(run, step, {
        status: job.status === "completed" ? "completed" : "failed",
        jobId: job.id,
        detail: {
          exitCode: result.exitCode ?? null,
          stdout: String(result.stdout ?? "").slice(-500),
        },
      });
      if (job.status !== "completed") {
        await this.repairStep(run, project, testCommand, "test");
      }
    }

    // 5. Build.
    if (run.options.build && buildCommand) {
      const step = this.beginStep(run, "build", "Run the production build");
      const job = this.executionService.start(project.id, {
        command: buildCommand,
        kind: "build",
        timeoutMs: 120000,
      });
      const { result } = await this.awaitJob(job);
      this.finishStep(run, step, {
        status: job.status === "completed" ? "completed" : "failed",
        jobId: job.id,
        detail: { exitCode: result.exitCode ?? null },
      });
      if (job.status !== "completed") {
        await this.repairStep(run, project, buildCommand, "build");
      }
    }

    run.status = "completed";
    run.finishedAt = new Date().toISOString();
    this.emitPipeline("pipeline_completed", run);
    this.persistRun(run);
  }

  /**
   * Autonomous repair for a failed pipeline step: the provider diagnoses the real
   * failing job, the proposed files are applied, and the same command is rerun.
   */
  async repairStep(run, project, command, kind) {
    if (!run.options.repairRounds) return;
    const step = this.beginStep(run, "repair", `AI repair for the ${kind} step`);
    const failedJob = this.executionService
      .listJobs(project.id)
      .find((job) => job.kind === kind && job.status === "failed");
    if (!failedJob) {
      this.finishStep(run, step, {
        status: "failed",
        error: "No failing job captured to diagnose",
      });
      return;
    }
    try {
      const proposal = await this.repairService.propose({ project, jobId: failedJob.id });
      if (!proposal.files.length) {
        this.finishStep(run, step, {
          status: "failed",
          error: proposal.simulated
            ? "Offline draft proposed no file changes; configure a real provider for autonomous repair"
            : "The provider proposed no file changes",
          detail: { summary: proposal.summary, simulated: proposal.simulated },
        });
        return;
      }
      const verification = await this.repairService.applyAndVerify({
        project,
        files: proposal.files,
        command,
        maxRounds: run.options.repairRounds,
        createdBy: "pipeline-repair",
        initialProposal: proposal,
      });
      const lastRound = verification.rounds.at(-1);
      const repairedStep = run.steps.find((s) => s.kind === kind && s.status === "failed");
      if (repairedStep) {
        repairedStep.verified = verification.verified;
        repairedStep.repairRounds = verification.rounds.length;
      }
      this.finishStep(run, step, {
        status: verification.verified ? "completed" : "failed",
        verified: verification.verified,
        jobId: lastRound?.jobId ?? null,
        detail: {
          provider: verification.provider,
          simulated: verification.simulated,
          rounds: verification.rounds,
          note: verification.simulated
            ? "Repair drafted by the offline mock; configure a real provider for genuine LLM repair"
            : undefined,
        },
      });
    } catch (error) {
      this.finishStep(run, step, { status: "failed", error: error.message });
    }
  }
}
