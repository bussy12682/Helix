/**
 * HELIX AI Engineering Operating System — Project Context (memory)
 * Builds a compact, factual brief of everything an agent needs to know about an
 * existing project before proposing changes: the file tree, declared dependencies
 * and scripts, recent real execution history, and prior repair attempts.
 * Everything here is derived from live services — nothing is inferred or invented.
 */

const MAX_EXECUTIONS = 10;
const MAX_REPAIRS = 5;
const MAX_PIPELINE_RUNS = 5;
const STDOUT_TAIL_BYTES = 2000;

function summarizePackageJson(content) {
  let parsed = null;
  try {
    parsed = JSON.parse(content);
  } catch {
    return { valid: false, error: "package.json is not valid JSON" };
  }
  return {
    valid: true,
    name: parsed.name ?? null,
    scripts: parsed.scripts ?? {},
    dependencies: Object.keys(parsed.dependencies ?? {}),
    devDependencies: Object.keys(parsed.devDependencies ?? {}),
    engines: parsed.engines ?? null,
  };
}

export function buildProjectContext({ workspaceService, executionService, project }) {
  const files = workspaceService.list(project.id);
  const packageFile = workspaceService.read(project.id, "package.json");
  const jobs = executionService.listJobs(project.id);

  return {
    project: {
      id: project.id,
      name: project.name,
      description: project.description ?? "",
      keyFeatures: project.keyFeatures ?? [],
      techStack: project.techStack ?? [],
    },
    files: files.map((file) => ({
      path: file.path,
      bytes: file.bytes,
      version: file.version,
      lastEditedBy: file.updatedBy ?? file.createdBy ?? null,
    })),
    fileCount: files.length,
    totalBytes: files.reduce((total, file) => total + file.bytes, 0),
    packageJson: packageFile ? summarizePackageJson(packageFile.content) : null,
    recentExecutions: jobs.slice(0, MAX_EXECUTIONS).map((job) => ({
      id: job.id,
      kind: job.kind,
      command: Array.isArray(job.command) ? job.command.join(" ") : job.command,
      status: job.status,
      exitCode: job.result?.exitCode ?? null,
      createdAt: job.createdAt,
    })),
    repairHistory: (project.repairHistory ?? []).slice(0, MAX_REPAIRS),
    pipelineRuns: (project.pipelineRuns ?? []).slice(0, MAX_PIPELINE_RUNS),
  };
}

/**
 * Renders the context as a bounded string suitable for an LLM prompt.
 * Includes the tail of the most recent failed execution so the model sees the
 * actual runtime error, not a summary of it.
 */
export function formatProjectContextForPrompt(context, { includeErrorTail = true } = {}) {
  const lines = [];
  lines.push(`Project: ${context.project.name}`);
  if (context.project.description) lines.push(`Description: ${context.project.description}`);
  if (context.project.keyFeatures?.length) lines.push(`Key features: ${context.project.keyFeatures.join(", ")}`);
  if (context.project.techStack?.length) lines.push(`Tech stack: ${context.project.techStack.join(", ")}`);
  lines.push(`Workspace files (${context.fileCount}, ${context.totalBytes} bytes):`);
  for (const file of context.files.slice(0, 200)) {
    lines.push(`  - ${file.path} (${file.bytes} bytes, v${file.version})`);
  }
  if (context.packageJson?.valid) {
    const pkg = context.packageJson;
    lines.push(`Package: ${pkg.name ?? "unnamed"}`);
    lines.push(`Scripts: ${JSON.stringify(pkg.scripts)}`);
    lines.push(
      `Dependencies: ${[...pkg.dependencies, ...pkg.devDependencies].join(", ") || "none declared"}`,
    );
  } else if (context.packageJson) {
    lines.push(`Package: ${context.packageJson.error}`);
  }
  if (context.recentExecutions.length) {
    lines.push("Recent executions (newest first):");
    for (const job of context.recentExecutions) {
      lines.push(`  - [${job.kind}] ${job.command} => ${job.status}${job.exitCode != null ? ` (exit ${job.exitCode})` : ""}`);
    }
  }
  if (includeErrorTail) {
    const failed = context.recentExecutions.find((job) => job.status === "failed");
    if (failed) {
      lines.push(`Last failed command output is supplied separately with the failure details.`);
    }
  }
  if (context.repairHistory.length) {
    lines.push("Previous repair attempts:");
    for (const repair of context.repairHistory) {
      lines.push(
        `  - ${repair.createdAt} ${repair.verified ? "verified" : "not verified"}: ${repair.summary}`,
      );
    }
  }
  if (context.pipelineRuns.length) {
    lines.push("Previous autonomous runs:");
    for (const run of context.pipelineRuns) {
      lines.push(`  - ${run.startedAt} ${run.status}${run.error ? ` (${run.error})` : ""}`);
    }
  }
  return lines.join("\n").slice(0, 16000);
}

/** Bounded stdout/stderr tail used when attaching real job output to prompts. */
export function outputTail(text, bytes = STDOUT_TAIL_BYTES) {
  const value = String(text ?? "");
  return value.length > bytes ? value.slice(-bytes) : value;
}
