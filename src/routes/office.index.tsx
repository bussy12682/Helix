import { createFileRoute, Link } from "@tanstack/react-router";
import {
  AlertTriangle,
  CheckCircle2,
  Maximize2,
  MessageSquareWarning,
  RotateCcw,
  ShieldAlert,
  Square,
  XCircle,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { AppShell, Meter, Panel, StatusPill } from "@/components/helix/app-shell";
import {
  ProviderBadge,
  taskStatusLabel,
  taskTone,
  workflowTone,
} from "@/components/helix/workflow-ui";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  approveWorkflowCheckpoint,
  cancelWorkflow,
  getStoredSessionToken,
  retryWorkflow,
  startProjectWorkflow,
} from "@/lib/api";
import { useActiveProject } from "@/lib/use-active-project";
import { useWorkflowStream } from "@/lib/use-workflow-stream";

export const Route = createFileRoute("/office/")({
  head: () => ({
    meta: [
      { title: "AI Engineering Office — HELIX" },
      {
        name: "description",
        content:
          "Watch your Project Manager AI coordinate architecture, database, backend, frontend, QA, security and DevOps agents.",
      },
      { property: "og:title", content: "AI Engineering Office — HELIX" },
      { property: "og:description", content: "Your nine-agent engineering workforce, live." },
    ],
  }),
  component: Office,
});

const agentStatusLabel: Record<string, string> = {
  working: "Working",
  queued: "Queued",
  done: "Completed",
  idle: "Idle",
  awaiting_approval: "Awaiting Approval",
  failed: "Failed",
  cancelled: "Cancelled",
};

function Office() {
  const { projects, project, projectId, setProjectId, isLoading } = useActiveProject();
  const { floorState, liveOutput, connected, error, refresh } = useWorkflowStream(projectId);
  const [comments, setComments] = useState("");
  const [busy, setBusy] = useState(false);

  async function act(label: string, fn: (token: string) => Promise<unknown>, success: string) {
    const token = getStoredSessionToken();
    if (!token) return;
    setBusy(true);
    try {
      await fn(token);
      toast.success(success);
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? `${label}: ${err.message}` : `${label} failed`);
    } finally {
      setBusy(false);
    }
  }

  const checkpoint = floorState?.currentCheckpoint ?? null;
  const workflowId = floorState?.workflowId;
  const status = floorState?.workflowStatus ?? "idle";
  const decide = (approved: boolean, revise: boolean, success: string) =>
    act(
      "Checkpoint",
      async (token) => {
        if (!workflowId || !checkpoint) return;
        await approveWorkflowCheckpoint(
          workflowId,
          checkpoint.checkpointType,
          approved,
          comments,
          token,
          { revise },
        );
        setComments("");
      },
      success,
    );

  const pmAgent = floorState?.agents.find((a) => a.role === "product_manager");
  const otherAgents = floorState?.agents.filter((a) => a.role !== "product_manager") ?? [];
  const runningTask = floorState?.tasks.find(
    (t) => t.status === "running" || t.status === "needs_revision",
  );

  if (!isLoading && projects.length === 0) {
    return (
      <AppShell title="AI Engineering Office" subtitle="No projects yet">
        <Panel
          title="Start your first project"
          description="The nine-agent workforce runs per project."
        >
          <Button asChild>
            <Link to="/projects/new">Create a project</Link>
          </Button>
        </Panel>
      </AppShell>
    );
  }

  return (
    <AppShell
      title="AI Engineering Office"
      subtitle={
        project ? `Your 9-agent engineering team is building: ${project.name}` : "Loading project…"
      }
      action={
        <div className="flex items-center gap-2">
          {projects.length > 1 && (
            <select
              aria-label="Active project"
              className="h-9 rounded-md border border-input bg-background px-2 text-sm"
              value={projectId ?? ""}
              onChange={(e) => setProjectId(e.target.value)}
            >
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          )}
          <Button asChild variant="outline">
            <Link to="/office/tasks">
              <Maximize2 className="mr-1.5 h-4 w-4" /> Task Flow &amp; Artifacts
            </Link>
          </Button>
        </div>
      }
    >
      {error && (
        <div className="mb-4 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {floorState && !floorState.hasActiveWorkflow && projectId && (
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-5">
          <div>
            <p className="text-sm font-semibold">
              The workforce has not started on this project yet.
            </p>
            <p className="text-xs text-muted-foreground">
              Starting dispatches the Product Manager AI; you approve architecture and release
              gates.
            </p>
          </div>
          <Button
            disabled={busy}
            onClick={() =>
              void act("Start", (t) => startProjectWorkflow(projectId, t), "Workforce dispatched.")
            }
          >
            Start AI workforce
          </Button>
        </div>
      )}

      {(status === "failed" || status === "cancelled") && workflowId && (
        <div className="mb-6 flex flex-wrap items-start gap-4 rounded-xl border-2 border-destructive/40 bg-card p-5">
          <AlertTriangle className="mt-0.5 h-6 w-6 shrink-0 text-destructive" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">Workflow {status}</p>
            <p className="mt-1 break-words text-xs text-muted-foreground">
              {floorState?.workflowError ?? "The run stopped."}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Completed tasks and artifacts are kept. Retry re-runs only failed or cancelled tasks.
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              disabled={busy}
              onClick={() =>
                void act("Retry", (t) => retryWorkflow(workflowId, t), "Retrying failed tasks.")
              }
            >
              <RotateCcw className="mr-1.5 h-4 w-4" /> Retry
            </Button>
            {projectId && (
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() =>
                  void act(
                    "Restart",
                    (t) => startProjectWorkflow(projectId, t, { restart: true }),
                    "Started a fresh workflow.",
                  )
                }
              >
                Start over
              </Button>
            )}
          </div>
        </div>
      )}

      {checkpoint && (
        <div className="mb-6 rounded-xl border-2 border-primary/40 bg-card p-5 shadow-lg">
          <div className="flex items-start gap-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/20 text-primary">
              <ShieldAlert className="h-6 w-6" />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span className="rounded bg-primary/10 px-2 py-0.5 text-xs font-bold uppercase tracking-wide text-primary">
                  Human Approval Checkpoint
                </span>
                <span className="text-xs text-muted-foreground">Required before proceeding</span>
              </div>
              <h3 className="mt-1 text-base font-semibold">{checkpoint.title}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{checkpoint.summary}</p>
              <Textarea
                placeholder="Review comments. Required when requesting a revision."
                value={comments}
                onChange={(e) => setComments(e.target.value)}
                className="mt-3 max-w-xl text-xs"
                rows={2}
              />
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <Button
                  size="sm"
                  onClick={() =>
                    void decide(true, false, "Checkpoint approved. Resuming workforce.")
                  }
                  disabled={busy}
                >
                  <CheckCircle2 className="mr-1.5 h-4 w-4" /> Approve &amp; Continue
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    void decide(
                      false,
                      true,
                      "Revision requested. The agent is reworking its output.",
                    )
                  }
                  disabled={busy || !comments.trim()}
                  title={
                    comments.trim() ? undefined : "Add comments describing the changes you want"
                  }
                >
                  <MessageSquareWarning className="mr-1.5 h-4 w-4" /> Request Revision
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="text-destructive hover:bg-destructive/10"
                  onClick={() =>
                    void decide(false, false, "Checkpoint rejected. Workflow stopped.")
                  }
                  disabled={busy}
                >
                  <XCircle className="mr-1.5 h-4 w-4" /> Reject
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="grid gap-5 xl:grid-cols-[1.6fr_1fr]">
        <Panel
          title="Live Engineering Floor"
          description={`Workforce status: ${status.replace("_", " ").toUpperCase()} · ${floorState?.progress ?? 0}% complete`}
          action={
            <div className="flex items-center gap-2">
              <StatusPill tone={connected ? "live" : "idle"}>
                {connected ? "Live" : "Reconnecting"}
              </StatusPill>
              {workflowId &&
                (status === "running" ||
                  status === "pending" ||
                  status === "awaiting_approval") && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() =>
                      void act(
                        "Cancel",
                        (t) => cancelWorkflow(workflowId, t),
                        "Workflow cancelled.",
                      )
                    }
                  >
                    <Square className="mr-1.5 h-3.5 w-3.5" /> Cancel
                  </Button>
                )}
            </div>
          }
        >
          <div className="rounded-xl border border-border bg-muted/40 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className="flex h-12 w-12 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
                  PM
                </span>
                <div>
                  <p className="text-sm font-semibold">{pmAgent?.name ?? "Product Manager AI"}</p>
                  <p className="text-xs text-muted-foreground">
                    {pmAgent?.currentTask ?? "Planning & Orchestration"}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <ProviderBadge
                  provider={pmAgent?.provider}
                  model={pmAgent?.model}
                  simulated={pmAgent?.simulated}
                />
                <StatusPill tone={taskTone(pmAgent?.status ?? "idle")}>
                  {agentStatusLabel[pmAgent?.status ?? "idle"]}
                </StatusPill>
              </div>
            </div>
            <div className="mt-3 flex items-center gap-2">
              <Meter value={pmAgent?.progress ?? 0} />
              <span className="text-xs tabular-nums text-muted-foreground">
                {pmAgent?.progress ?? 0}%
              </span>
            </div>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {otherAgents.map((a) => (
              <div key={a.id || a.role} className="rounded-xl border border-border bg-card p-3">
                <div className="flex items-center justify-between">
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-accent text-[11px] font-semibold text-accent-foreground">
                    {a.initials}
                  </span>
                  <StatusPill tone={taskTone(a.status)}>
                    {agentStatusLabel[a.status] ?? a.status}
                  </StatusPill>
                </div>
                <p className="mt-2 text-xs font-semibold">{a.name}</p>
                <p className="truncate text-[11px] text-muted-foreground" title={a.currentTask}>
                  {a.currentTask}
                </p>
                <div className="mt-1 min-h-[18px]">
                  <ProviderBadge provider={a.provider} model={a.model} simulated={a.simulated} />
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <Meter value={a.progress} />
                  <span className="text-[11px] tabular-nums text-muted-foreground">
                    {a.progress}%
                  </span>
                </div>
              </div>
            ))}
          </div>

          {runningTask && (
            <div className="mt-4 rounded-xl border border-border bg-muted/20 p-3">
              <p className="text-xs font-semibold">Live output · {runningTask.agent}</p>
              <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-all font-mono text-[11px] text-foreground/80">
                {liveOutput[runningTask.id] || "Waiting for model tokens…"}
              </pre>
            </div>
          )}
        </Panel>

        <Panel
          title="Task Dependency Status"
          description="Live coordination across all nine agents"
        >
          <ul className="space-y-3">
            {(floorState?.tasks ?? []).map((t) => (
              <li
                key={t.id}
                className="flex items-start gap-3 rounded-lg border border-border p-2.5"
              >
                <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent text-[10px] font-bold">
                  {t.agent.slice(0, 2).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-xs font-semibold">{t.task}</p>
                    <StatusPill tone={taskTone(t.status)}>
                      {taskStatusLabel[t.status] ?? t.status}
                    </StatusPill>
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-2">
                    <p className="text-[11px] text-muted-foreground">{t.agent}</p>
                    <ProviderBadge provider={t.provider} model={t.model} simulated={t.simulated} />
                  </div>
                  {t.summary && (
                    <p className="mt-1 rounded bg-muted/30 p-1 text-[11px] text-foreground/80">
                      {t.summary}
                    </p>
                  )}
                  {t.error && (
                    <p className="mt-1 break-words rounded bg-destructive/5 p-1 text-[11px] text-destructive">
                      {t.error}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ul>
          <div className="mt-4">
            <StatusPill tone={workflowTone(status)}>
              Workflow: {status.replace("_", " ")}
            </StatusPill>
          </div>
          <Button asChild variant="outline" className="mt-5 w-full">
            <Link to="/office/tasks">View Full Task Artifacts &amp; Files</Link>
          </Button>
        </Panel>
      </div>
    </AppShell>
  );
}
