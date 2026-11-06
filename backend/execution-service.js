import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { access, readFile } from "node:fs/promises";
import path from "node:path";

const ALLOWED_EXECUTABLES = new Set(["node", "npm", "npx", "python3"]);
const OUTPUT_LIMIT = 1024 * 1024;
const JOB_LIMIT_PER_PROJECT = 100;
const ACTIVE_JOB_LIMIT_PER_PROJECT = 25;
const SAFE_ENV_KEYS = new Set(["HOST", "PORT", "NODE_ENV", "npm_config_cache"]);
const DURABLE_OUTPUT_LIMIT = 64 * 1024;

/**
 * Bounded snapshot persisted on every job transition. Live jobs may buffer up
 * to 1 MiB of output each; the durable record keeps the tail so restart
 * recovery and post-mortem debugging stay cheap without unbounded growth.
 */
export function toDurableJob(job) {
  const tail = (text) =>
    typeof text === "string" && text.length > DURABLE_OUTPUT_LIMIT
      ? text.slice(-DURABLE_OUTPUT_LIMIT)
      : (text ?? "");
  const result = job.result
    ? {
        ...job.result,
        stdout: tail(job.result.stdout),
        stderr: tail(job.result.stderr),
      }
    : null;
  return {
    id: job.id,
    projectId: job.projectId,
    kind: job.kind,
    command: [...job.command],
    timeoutMs: job.timeoutMs,
    testSuiteName: job.testSuiteName ?? null,
    allowNetwork: Boolean(job.allowNetwork),
    env: { ...job.env },
    status: job.status,
    createdAt: job.createdAt,
    startedAt: job.startedAt ?? null,
    completedAt: job.completedAt ?? null,
    stopRequested: Boolean(job.stopRequested),
    outputTruncated: Boolean(job.outputTruncated),
    stdout: tail(job.stdout),
    stderr: tail(job.stderr),
    result,
  };
}

export function parseCommand(command) {
  if (Array.isArray(command)) {
    if (
      !command.length ||
      command.length > 64 ||
      command.some((part) => typeof part !== "string" || part.length > 4000) ||
      command.join(" ").length > 8000
    ) {
      throw new Error("Command arguments are invalid");
    }
    return [...command];
  }
  if (typeof command !== "string" || !command.trim() || command.length > 4000) {
    throw new Error("A command of up to 4,000 characters is required");
  }
  const args = [];
  let current = "";
  let quote = null;
  let escaped = false;
  let started = false;
  for (const char of command) {
    if (escaped) {
      current += char;
      escaped = false;
      started = true;
    } else if (char === "\\" && quote !== "'") {
      escaped = true;
      started = true;
    } else if (quote) {
      if (char === quote) quote = null;
      else current += char;
      started = true;
    } else if (char === "'" || char === '"') {
      quote = char;
      started = true;
    } else if (/\s/.test(char)) {
      if (started) {
        args.push(current);
        current = "";
        started = false;
      }
    } else {
      current += char;
      started = true;
    }
  }
  if (quote || escaped) throw new Error("Command contains an unterminated quote or escape");
  if (started) args.push(current);
  if (!args.length || args.length > 64) throw new Error("Command must contain 1–64 arguments");
  return args;
}

async function exists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

export class ExecutionService extends EventEmitter {
  constructor({
    workspaceService,
    bwrapPath = "bwrap",
    prlimitPath = "/usr/bin/prlimit",
    maxConcurrent = 2,
    persistence = null,
  } = {}) {
    super();
    this.setMaxListeners(0);
    this.workspaceService = workspaceService;
    this.bwrapPath = bwrapPath;
    this.prlimitPath = prlimitPath;
    this.maxConcurrent = Math.max(1, Math.min(8, Number(maxConcurrent) || 2));
    // Optional durable-record adapter: { saveJob, deleteJob }. When wired,
    // every job transition is written through so restarts can recover.
    this.persistence = persistence;
    this.active = 0;
    this.queues = new Map();
    this.children = new Map();
    this.jobs = new Map();
    this.availability = null;
  }

  persistJob(job) {
    if (!this.persistence?.saveJob) return;
    try {
      this.persistence.saveJob(toDurableJob(job));
    } catch {
      // Durability must never break the live execution path; the next
      // transition retries and store status surfaces persistent failures.
    }
  }

  /**
   * Loads durable job records (from a previous process life) into the live
   * registry so history is queryable across restarts. Records are restored
   * WITHOUT their process handles — interrupted work is finalized by
   * recoverInterrupted().
   */
  hydrateJobs(records = []) {
    for (const record of records) {
      if (!record?.id || this.jobs.has(record.id)) continue;
      const job = {
        ...record,
        command: [...record.command],
        stdout: record.stdout ?? "",
        stderr: record.stderr ?? "",
        completion: Promise.resolve(
          record.result ?? { executed: false, status: "RESTORED", command: record.command },
        ),
      };
      this.jobs.set(job.id, job);
    }
    return this.jobs.size;
  }

  /**
   * Finalizes jobs that were queued/running when the previous process died.
   * Their child processes no longer exist, so the honest outcome is
   * "interrupted" — never silently resurrected or left running forever.
   */
  recoverInterrupted() {
    let interrupted = 0;
    for (const job of this.jobs.values()) {
      if (job.completedAt) continue;
      job.status = "interrupted";
      job.completedAt = new Date().toISOString();
      job.result = {
        executed: false,
        status: "INTERRUPTED",
        command: job.command,
        error: "interrupted by backend restart",
        stdout: job.stdout,
        stderr: job.stderr,
      };
      this.persistJob(job);
      interrupted += 1;
    }
    return interrupted;
  }

  async getStatus() {
    if (!this.availability) {
      if (!(await exists(this.prlimitPath))) {
        return {
          available: false,
          isolation: "none",
          reason: "prlimit is required for secure execution",
        };
      }
      const probeArgs = ["--unshare-all", "--die-with-parent", "--ro-bind", "/usr", "/usr"];
      if (await exists("/lib")) probeArgs.push("--symlink", "usr/lib", "/lib");
      if (await exists("/lib64")) probeArgs.push("--symlink", "usr/lib64", "/lib64");
      probeArgs.push("--", "/usr/bin/true");
      this.availability = new Promise((resolve) => {
        let settled = false;
        const finish = (status) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(status);
        };
        const probe = spawn(this.bwrapPath, probeArgs, { stdio: "ignore" });
        probe.once("error", (error) =>
          finish({ available: false, isolation: "none", reason: error.message }),
        );
        probe.once("exit", (code) =>
          finish(
            code === 0
              ? { available: true, isolation: "bubblewrap", network: "disabled-by-default" }
              : {
                  available: false,
                  isolation: "none",
                  reason: `Bubblewrap probe exited with code ${code}`,
                },
          ),
        );
        const timer = setTimeout(() => {
          probe.kill("SIGKILL");
          finish({ available: false, isolation: "none", reason: "Bubblewrap probe timed out" });
        }, 3000);
        timer.unref();
      });
    }
    return this.availability;
  }

  toPublicJob(job) {
    return {
      id: job.id,
      projectId: job.projectId,
      kind: job.kind,
      command: [...job.command],
      status: job.status,
      createdAt: job.createdAt,
      startedAt: job.startedAt ?? null,
      completedAt: job.completedAt ?? null,
      result: job.result ?? null,
    };
  }

  getJob(projectId, jobId) {
    const job = this.jobs.get(jobId);
    return job?.projectId === projectId ? job : null;
  }

  listJobs(projectId) {
    return [...this.jobs.values()]
      .filter((job) => job.projectId === projectId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, JOB_LIMIT_PER_PROJECT)
      .map((job) => this.toPublicJob(job));
  }

  emitJob(type, job, extra = {}) {
    this.emit("event", {
      id: randomUUID(),
      type,
      timestamp: new Date().toISOString(),
      projectId: job.projectId,
      payload: { job: this.toPublicJob(job), ...extra },
    });
  }

  start(
    projectId,
    {
      command,
      timeoutMs = 30000,
      testSuiteName = null,
      kind = "command",
      allowNetwork = false,
      bypassQueue = false,
      env = {},
    } = {},
  ) {
    const args = parseCommand(command);
    if (!ALLOWED_EXECUTABLES.has(path.basename(args[0])) || args[0].includes("/")) {
      throw new Error(`Allowed executables: ${[...ALLOWED_EXECUTABLES].join(", ")}`);
    }
    const maximum = kind === "preview" ? 24 * 60 * 60 * 1000 : kind === "install" ? 600000 : 300000;
    const timeout = Math.max(100, Math.min(maximum, Number(timeoutMs) || 30000));
    const safeEnv = {};
    for (const [key, value] of Object.entries(env)) {
      if (SAFE_ENV_KEYS.has(key) && (typeof value === "string" || typeof value === "number")) {
        safeEnv[key] = String(value).slice(0, 200);
      }
    }
    const activeForProject = [...this.jobs.values()].filter(
      (candidate) => candidate.projectId === projectId && !candidate.completedAt,
    ).length;
    if (activeForProject >= ACTIVE_JOB_LIMIT_PER_PROJECT) {
      throw new Error(
        `A maximum of ${ACTIVE_JOB_LIMIT_PER_PROJECT} active execution jobs is allowed per project`,
      );
    }
    const job = {
      id: `exec_${randomUUID()}`,
      projectId,
      kind,
      command: args,
      timeoutMs: timeout,
      testSuiteName,
      allowNetwork: Boolean(allowNetwork),
      env: safeEnv,
      status: "queued",
      createdAt: new Date().toISOString(),
      result: null,
      stopRequested: false,
      stdout: "",
      stderr: "",
      outputBytes: 0,
    };
    this.jobs.set(job.id, job);
    const projectJobs = [...this.jobs.values()]
      .filter((candidate) => candidate.projectId === projectId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    for (const stale of projectJobs.slice(JOB_LIMIT_PER_PROJECT)) {
      if (stale.completedAt) {
        this.jobs.delete(stale.id);
        this.persistence?.deleteJob?.(stale.id);
      }
    }
    this.persistJob(job);

    job.completion = bypassQueue
      ? Promise.resolve().then(() => this.runJob(job))
      : this.enqueue(job);
    // Jobs always resolve to an honest result; consumers never need an unhandled rejection handler.
    job.completion.catch(() => {});
    this.emitJob("execution_queued", job);
    return job;
  }

  enqueue(job) {
    const previous = this.queues.get(job.projectId) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(() => this.runJob(job));
    this.queues.set(job.projectId, next);
    next.finally(() => {
      if (this.queues.get(job.projectId) === next) this.queues.delete(job.projectId);
    });
    return next;
  }

  async execute(projectId, options = {}) {
    const job = this.start(projectId, options);
    return job.completion;
  }

  async runJob(job) {
    if (job.stopRequested) return this.finishJob(job, this.stoppedResult(job));
    while (this.active >= this.maxConcurrent && !job.stopRequested) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    if (job.stopRequested) return this.finishJob(job, this.stoppedResult(job));
    this.active += 1;
    job.status = "running";
    job.startedAt = new Date().toISOString();
    this.persistJob(job);
    this.emitJob("execution_started", job);
    try {
      const result = await this.executeIsolated(job);
      return this.finishJob(job, result);
    } catch (error) {
      return this.finishJob(job, {
        executed: false,
        status: "FAILED",
        error: error.message,
        command: job.command,
        stdout: job.stdout,
        stderr: job.stderr,
      });
    } finally {
      this.active -= 1;
    }
  }

  stoppedResult(job) {
    return {
      executed: false,
      status: "STOPPED",
      command: job.command,
      stdout: job.stdout,
      stderr: job.stderr,
    };
  }

  finishJob(job, result) {
    if (job.completedAt) return result;
    job.result = result;
    job.completedAt = new Date().toISOString();
    job.status = job.stopRequested
      ? "stopped"
      : !result.executed && result.status === "UNAVAILABLE"
        ? "unavailable"
        : result.exitCode === 0 && !result.timedOut && !result.outputTruncated
          ? "completed"
          : "failed";
    this.children.delete(job.id);
    this.persistJob(job);
    this.emitJob("execution_completed", job);
    return result;
  }

  stop(projectId, jobId) {
    const job = this.getJob(projectId, jobId);
    if (!job) return null;
    if (job.completedAt) return job;
    job.stopRequested = true;
    job.status = "stopping";
    this.persistJob(job);
    this.emitJob("execution_stopping", job);
    const child = this.children.get(job.id);
    if (child) this.killChild(child);
    else if (!job.startedAt) return (this.finishJob(job, this.stoppedResult(job)), job);
    return job;
  }

  killChild(child) {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      child.kill("SIGKILL");
    }
  }

  appendOutput(job, stream, chunk) {
    const text = chunk.toString("utf8");
    job.outputBytes += chunk.length;
    job[stream] = (job[stream] + text).slice(-OUTPUT_LIMIT);
    if (job.outputBytes > OUTPUT_LIMIT) {
      job.outputTruncated = true;
      const child = this.children.get(job.id);
      if (child) this.killChild(child);
      return;
    }
    this.emitJob("execution_output", job, { stream, data: text });
  }

  async executeIsolated(job) {
    const status = await this.getStatus();
    if (!status.available) {
      return {
        executed: false,
        status: "UNAVAILABLE",
        sandbox: status,
        error: "Secure execution is unavailable",
      };
    }
    const root = await this.workspaceService.materialize(job.projectId);
    const bwrapArgs = ["--unshare-all", "--die-with-parent", "--new-session", "--cap-drop", "ALL"];
    if (job.allowNetwork) bwrapArgs.push("--share-net");
    bwrapArgs.push(
      "--ro-bind",
      "/usr",
      "/usr",
      "--symlink",
      "usr/bin",
      "/bin",
      "--symlink",
      "usr/sbin",
      "/sbin",
    );
    if (await exists("/lib")) bwrapArgs.push("--symlink", "usr/lib", "/lib");
    if (await exists("/lib64")) bwrapArgs.push("--symlink", "usr/lib64", "/lib64");
    if (!process.execPath.startsWith("/usr/") && (await exists(process.execPath))) {
      bwrapArgs.push("--ro-bind", process.execPath, process.execPath);
    }
    if (job.allowNetwork) {
      for (const file of ["/etc/resolv.conf", "/etc/hosts", "/etc/nsswitch.conf", "/etc/ssl"]) {
        if (await exists(file)) bwrapArgs.push("--ro-bind", file, file);
      }
    }
    const environment = {
      HOME: "/tmp",
      PATH: "/usr/local/bin:/usr/bin:/bin",
      npm_config_cache: "/tmp/npm-cache",
      CI: "true",
      NODE_ENV:
        job.kind === "build" ? "production" : job.kind === "preview" ? "development" : "test",
      NODE_OPTIONS: "--max-old-space-size=512",
      ...job.env,
    };
    for (const [key, value] of Object.entries(environment)) {
      bwrapArgs.push("--setenv", key, value);
    }
    bwrapArgs.push(
      "--bind",
      root,
      "/workspace",
      "--chdir",
      "/workspace",
      "--size",
      "67108864",
      "--tmpfs",
      "/tmp",
      "--dev",
      "/dev",
      "--proc",
      "/proc",
      "--",
      ...job.command,
    );

    const started = Date.now();
    return new Promise((resolve) => {
      const launcherArgs = [
        `--cpu=${Math.ceil(job.timeoutMs / 1000)}`,
        "--as=4294967296",
        "--nofile=256",
        "--nproc=64",
        "--fsize=16777216",
        "--",
        this.bwrapPath,
        ...bwrapArgs,
      ];
      const child = spawn(this.prlimitPath, launcherArgs, {
        cwd: root,
        detached: true,
        stdio: ["ignore", "pipe", "pipe"],
        env: { PATH: "/usr/local/bin:/usr/bin:/bin" },
      });
      this.children.set(job.id, child);
      let timedOut = false;
      let settled = false;
      const finish = (result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.children.delete(job.id);
        resolve(result);
      };
      child.stdout.on("data", (chunk) => this.appendOutput(job, "stdout", chunk));
      child.stderr.on("data", (chunk) => this.appendOutput(job, "stderr", chunk));
      const timer = setTimeout(() => {
        timedOut = true;
        this.killChild(child);
      }, job.timeoutMs);
      timer.unref();
      child.once("error", (error) => {
        finish({
          executed: false,
          status: "FAILED",
          error: error.message,
          command: job.command,
          stdout: job.stdout,
          stderr: job.stderr,
        });
      });
      child.once("close", (exitCode, signal) => {
        finish({
          executed: true,
          status: job.stopRequested
            ? "STOPPED"
            : timedOut || job.outputTruncated
              ? "FAILED"
              : exitCode === 0
                ? job.testSuiteName
                  ? "PASS"
                  : "COMPLETED"
                : "FAILED",
          suite: job.testSuiteName || undefined,
          command: job.command,
          exitCode,
          signal,
          timedOut,
          outputTruncated: Boolean(job.outputTruncated),
          stdout: job.stdout,
          stderr: job.stderr,
          durationMs: Date.now() - started,
          sandbox: {
            isolation: "bubblewrap",
            network: job.allowNetwork ? "enabled-for-this-lifecycle-operation" : "disabled",
            timeoutMs: job.timeoutMs,
            virtualMemoryBytes: 4294967296,
            nodeHeapBytes: 536870912,
          },
        });
      });
    });
  }

  async runTests(
    projectId,
    { command = "npm test", timeoutMs = 60000, testSuiteName = "Project tests" } = {},
  ) {
    const args = parseCommand(command);
    if (args[0] === "npm" && args[1] === "test") {
      const root = this.workspaceService.projectRoot(projectId);
      await this.workspaceService.materialize(projectId);
      const packageJson = JSON.parse(
        await readFile(path.join(root, "package.json"), "utf8").catch(() => "{}"),
      );
      if (!packageJson.scripts?.test) {
        return {
          executed: false,
          status: "UNAVAILABLE",
          suite: testSuiteName,
          error: "package.json does not define a test script",
        };
      }
    }
    return this.execute(projectId, { command: args, timeoutMs, testSuiteName, kind: "test" });
  }

  close() {
    for (const child of this.children.values()) this.killChild(child);
  }
}
