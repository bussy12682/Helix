/**
 * HELIX AI Engineering Operating System — Repair Service
 * Turns a real failed execution job into an LLM diagnosis and a proposed patch,
 * and — when the caller explicitly authorizes it — applies the patch and VERIFIES
 * it by rerunning the failing command in the sandbox. A repair is reported as
 * verified only when a real job exited 0 after the patch was applied; there is no
 * other source of truth. Proposals are labelled simulated whenever the provider
 * that produced them was the offline mock.
 */

import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";

import { AGENT_ROLES } from "./ai/contracts.js";
import { AiProviderError } from "./ai/model-router.js";
import { normalizeWorkspacePath } from "./workspace-paths.js";
import { buildProjectContext, formatProjectContextForPrompt, outputTail } from "./project-context.js";

const MAX_REPAIR_ROUNDS = 3;
const DEFAULT_VERIFY_TIMEOUT_MS = 120000;

export class RepairService extends EventEmitter {
  constructor({ workspaceService, executionService, workforce, saveHistory }) {
    super();
    this.setMaxListeners(0);
    this.workspaceService = workspaceService;
    this.executionService = executionService;
    this.workforce = workforce;
    this.saveHistory = saveHistory;
  }

  emitRepair(type, projectId, payload) {
    this.emit("event", {
      id: randomUUID(),
      type,
      timestamp: new Date().toISOString(),
      projectId,
      payload,
    });
  }

  /**
   * Asks the configured provider to diagnose a real failed job and propose
   * complete replacement files. The provider receives the true command, exit
   * code, output tail, the project memory, and (when provided) the full content
   * of the file under repair.
   */
  async propose({ project, jobId, filePath = null }) {
    const job = this.executionService.getJob(project.id, String(jobId ?? ""));
    if (!job?.result) {
      throw Object.assign(new Error("A completed execution job is required for repair"), { status: 404 });
    }
    const context = buildProjectContext({
      workspaceService: this.workspaceService,
      executionService: this.executionService,
      project,
    });

    const selectedPath = filePath ? normalizeWorkspacePath(String(filePath)) : null;
    const file = selectedPath ? this.workspaceService.read(project.id, selectedPath) : null;
    const role = selectedPath && /\.(tsx|jsx|css|html)$/i.test(selectedPath)
      ? AGENT_ROLES.FRONTEND_ENGINEER
      : AGENT_ROLES.BACKEND_ENGINEER;

    let meta = null;
    const output = await this.workforce.getAgent(role).execute({
      workflowId: `repair_${job.id}`,
      projectId: project.id,
      taskId: `repair_${randomUUID()}`,
      taskTitle: "Diagnose a real execution failure and propose a minimal repair",
      context: {
        project: context.project,
        projectMemory: formatProjectContextForPrompt(context),
        failure: {
          command: job.command,
          exitCode: job.result.exitCode,
          stdout: outputTail(job.result.stdout),
          stderr: outputTail(job.result.stderr),
          timedOut: job.result.timedOut ?? false,
        },
        selectedFile: file ? { path: file.path, content: file.content } : null,
        workspaceFiles: this.workspaceService.list(project.id).map((artifact) => artifact.path),
        instruction:
          "Diagnose the failure from the captured runtime output. Return complete replacement files only for changes needed to fix the observed failure. Do not claim the repair has been tested; HELIX verifies repairs by rerunning the command.",
      },
      onMeta: (value) => { meta = value; },
    });

    const files = output.artifacts
      .filter((artifact) => artifact.content != null && artifact.path)
      .map((artifact) => ({
        name: artifact.name,
        type: artifact.type,
        path: normalizeWorkspacePath(artifact.path),
        content: artifact.content,
      }));

    return {
      summary: output.summary,
      files,
      decisions: output.decisions,
      basedOnJobId: job.id,
      provider: meta?.provider,
      model: meta?.model,
      simulated: meta?.provider === "mock",
      verified: false,
      role,
    };
  }

  /**
   * Applies the given files and verifies the repair by rerunning `command` in the
   * sandbox. If the rerun still fails and rounds remain, the new failure is fed
   * back to the provider for another patch. `verified` reflects only the real
   * final job result.
   */
  async applyAndVerify({
    project,
    files,
    command,
    maxRounds = 2,
    verifyTimeoutMs = DEFAULT_VERIFY_TIMEOUT_MS,
    createdBy = "repair",
    initialProposal = null,
  }) {
    if (!Array.isArray(files) || !files.length) {
      throw Object.assign(new Error("At least one reviewed file is required to apply a repair"), { status: 400 });
    }
    if (!Array.isArray(command) || !command.length) {
      throw Object.assign(new Error("A command array is required to verify a repair"), { status: 400 });
    }
    const rounds = Math.max(1, Math.min(MAX_REPAIR_ROUNDS, Number(maxRounds) || 1));
    const timeoutMs = Math.max(5000, Math.min(DEFAULT_VERIFY_TIMEOUT_MS, Number(verifyTimeoutMs) || DEFAULT_VERIFY_TIMEOUT_MS));

    const result = {
      verified: false,
      rounds: [],
      finalStatus: "failed",
      provider: initialProposal?.provider ?? null,
      simulated: initialProposal?.simulated ?? null,
    };
    let proposal = initialProposal;

    for (let round = 1; round <= rounds; round += 1) {
      const applied = [];
      for (const file of files) {
        const saved = await this.workspaceService.write(project.id, file.path, file.content, {
          createdBy,
          taskId: proposal ? `repair_${proposal.basedOnJobId ?? "manual"}` : null,
        });
        applied.push({ path: saved.path, version: saved.version });
      }
      await this.workspaceService.materialize(project.id);

      const verifyJob = this.executionService.start(project.id, {
        command,
        kind: "verify",
        timeoutMs,
        testSuiteName: "Repair verification",
      });
      const verifyResult = await verifyJob.completion;
      const roundRecord = {
        round,
        appliedFiles: applied,
        proposal: proposal
          ? { summary: proposal.summary, provider: proposal.provider, model: proposal.model, simulated: proposal.simulated }
          : null,
        jobId: verifyJob.id,
        exitCode: verifyResult.exitCode ?? null,
        status: verifyJob.status,
        stdout: outputTail(verifyResult.stdout, 1000),
        stderr: outputTail(verifyResult.stderr, 1000),
      };
      result.rounds.push(roundRecord);
      this.emitRepair("repair_round", project.id, {
        projectId: project.id,
        round: roundRecord.round,
        jobId: verifyJob.id,
        exitCode: verifyResult.exitCode ?? null,
        appliedFiles: applied,
      });

      if (verifyJob.status === "completed" && verifyResult.exitCode === 0) {
        result.verified = true;
        result.finalStatus = "completed";
        break;
      }

      if (round < rounds) {
        // Feed the NEW failure back to the provider for the next attempt.
        proposal = await this.propose({ project, jobId: verifyJob.id, filePath: files[0].path });
        result.provider = proposal.provider;
        result.simulated = proposal.simulated;
        files = proposal.files;
        this.emitRepair("repair_proposed", project.id, {
          projectId: project.id,
          round: round + 1,
          summary: proposal.summary,
          simulated: proposal.simulated,
          files: proposal.files.map((file) => file.path),
        });
      }
    }

    const historyEntry = {
      createdAt: new Date().toISOString(),
      summary: initialProposal?.summary ?? `${files.length} file(s) applied and verified by rerun`,
      verified: result.verified,
      rounds: result.rounds.length,
      provider: result.provider,
      simulated: result.simulated,
      command: command.join(" "),
    };
    this.saveHistory?.(project, historyEntry);
    this.emitRepair(result.verified ? "repair_verified" : "repair_failed", project.id, {
      projectId: project.id,
      verified: result.verified,
      rounds: result.rounds.length,
    });
    return result;
  }

  /** Maps provider failures to honest HTTP-facing outcomes without leaking keys. */
  static providerErrorResponse(error, requestId) {
    if (error instanceof AiProviderError) {
      return {
        status: error.code === "AI_NOT_CONFIGURED" ? 503 : 502,
        body: { error: { code: error.code, message: error.message, requestId } },
      };
    }
    return null;
  }
}
