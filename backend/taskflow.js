import { randomUUID } from "node:crypto";

export class TaskflowValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "TaskflowValidationError";
    this.code = "INVALID_TASKFLOW";
  }
}

export function validateTaskflow(tasks) {
  if (!Array.isArray(tasks) || !tasks.length || tasks.length > 50) {
    throw new TaskflowValidationError("TASKFLOW requires between 1 and 50 tasks");
  }
  const ids = new Set();
  for (const task of tasks) {
    if (!task || !/^[\w-]{1,80}$/.test(task.id ?? "")) throw new TaskflowValidationError("Every task needs a portable id");
    if (ids.has(task.id)) throw new TaskflowValidationError(`Duplicate task id: ${task.id}`);
    ids.add(task.id);
    if (typeof task.command !== "string" || !task.command.trim()) throw new TaskflowValidationError(`Task ${task.id} needs a command`);
    if (task.title != null && (typeof task.title !== "string" || task.title.length > 200)) throw new TaskflowValidationError(`Task ${task.id} has an invalid title`);
    if (!Array.isArray(task.dependencies ?? [])) throw new TaskflowValidationError(`Task ${task.id} dependencies must be an array`);
  }
  const graph = new Map(tasks.map((task) => [task.id, [...new Set(task.dependencies ?? [])]]));
  for (const [id, dependencies] of graph) {
    for (const dependency of dependencies) {
      if (!ids.has(dependency)) throw new TaskflowValidationError(`Task ${id} depends on unknown task ${dependency}`);
      if (dependency === id) throw new TaskflowValidationError(`Task ${id} cannot depend on itself`);
    }
  }
  const visiting = new Set();
  const visited = new Set();
  function visit(id) {
    if (visiting.has(id)) throw new TaskflowValidationError(`Dependency cycle includes task ${id}`);
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dependency of graph.get(id)) visit(dependency);
    visiting.delete(id);
    visited.add(id);
  }
  for (const id of ids) visit(id);
  return graph;
}

export class TaskflowEngine {
  constructor({ executionService }) {
    this.executionService = executionService;
    this.plans = new Map();
    this.activeRuns = new Map();
  }

  hydrate(plans = []) {
    for (const plan of plans) {
      if (!plan?.id || !plan.projectId) continue;
      if (plan.status === "running") {
        plan.status = "pending";
        for (const task of plan.tasks) {
          if (task.status === "running") task.status = "queued";
        }
        plan.interrupted = true;
      }
      this.plans.set(plan.id, plan);
    }
  }

  create(projectId, input, { persist = null } = {}) {
    const graph = validateTaskflow(input.tasks);
    const now = new Date().toISOString();
    const plan = {
      id: `flow_${randomUUID()}`,
      projectId,
      name: String(input.name ?? "Workspace TASKFLOW").slice(0, 120),
      status: "pending",
      tasks: input.tasks.map((task) => ({
        id: task.id,
        title: task.title?.trim() || task.id,
        command: task.command,
        dependencies: graph.get(task.id),
        timeoutMs: Math.max(100, Math.min(120000, Number(task.timeoutMs) || 30000)),
        status: "queued",
        result: null,
      })),
      createdAt: now,
      updatedAt: now,
    };
    this.plans.set(plan.id, plan);
    persist?.(plan);
    return plan;
  }

  getForProject(projectId) {
    return [...this.plans.values()].filter((plan) => plan.projectId === projectId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  getOwned(projectId, planId) {
    const plan = this.plans.get(planId);
    return plan?.projectId === projectId ? plan : null;
  }

  removeProject(projectId) {
    for (const [id, plan] of this.plans) if (plan.projectId === projectId) this.plans.delete(id);
  }

  run(planId, { persist = null } = {}) {
    if (this.activeRuns.has(planId)) return this.activeRuns.get(planId);
    const plan = this.plans.get(planId);
    if (!plan) return Promise.reject(new Error("TASKFLOW plan not found"));
    const run = this.execute(plan, persist).finally(() => this.activeRuns.delete(planId));
    this.activeRuns.set(planId, run);
    return run;
  }

  async execute(plan, persist) {
    plan.status = "running";
    for (const task of plan.tasks) {
      task.status = "queued";
      task.result = null;
    }
    plan.updatedAt = new Date().toISOString();
    persist?.(plan);
    const pending = new Map(plan.tasks.map((task) => [task.id, task]));
    while (pending.size) {
      const ready = [...pending.values()].filter((task) => task.dependencies.every((id) => plan.tasks.find((candidate) => candidate.id === id)?.status === "completed"));
      if (!ready.length) {
        for (const task of pending.values()) {
          task.status = "blocked";
          task.result = { executed: false, status: "BLOCKED", error: "A dependency failed or was blocked" };
        }
        plan.status = "failed";
        break;
      }
      await Promise.all(ready.map(async (task) => {
        pending.delete(task.id);
        task.status = "running";
        plan.updatedAt = new Date().toISOString();
        persist?.(plan);
        try {
          task.result = await this.executionService.execute(plan.projectId, { command: task.command, timeoutMs: task.timeoutMs });
          task.status = task.result.executed && task.result.exitCode === 0 && !task.result.timedOut && !task.result.outputTruncated ? "completed" : "failed";
        } catch (error) {
          task.result = { executed: false, status: "FAILED", error: error.message };
          task.status = "failed";
        }
        plan.updatedAt = new Date().toISOString();
        persist?.(plan);
      }));
    }
    if (plan.status !== "failed") plan.status = plan.tasks.every((task) => task.status === "completed") ? "completed" : "failed";
    plan.updatedAt = new Date().toISOString();
    persist?.(plan);
    return plan;
  }
}
