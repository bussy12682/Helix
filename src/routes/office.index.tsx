import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { CheckCircle2, AlertTriangle, Maximize2, RefreshCw, ShieldAlert, Sparkles, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { AppShell, Meter, Panel, StatusPill } from "@/components/helix/app-shell";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  approveWorkflowCheckpoint,
  getProjectOffice,
  getStoredSessionToken,
  listProjects,
  startProjectWorkflow,
  type OfficeFloorState,
} from "@/lib/api";

export const Route = createFileRoute("/office/")({
  head: () => ({
    meta: [
      { title: "AI Engineering Office — HELIX" },
      { name: "description", content: "Watch your Project Manager AI coordinate architecture, database, backend, frontend, QA, security and DevOps agents." },
      { property: "og:title", content: "AI Engineering Office — HELIX" },
      { property: "og:description", content: "Your nine-agent engineering workforce, live." },
    ],
  }),
  component: Office,
});

const statusLabel: Record<string, string> = {
  working: "Working",
  queued: "Queued",
  done: "Completed",
  idle: "Idle",
  awaiting_approval: "Awaiting Approval",
  failed: "Failed",
};

function Office() {
  const navigate = useNavigate();
  const [projectId, setProjectId] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return window.sessionStorage.getItem("helix_active_project_id");
  });
  const [projectName, setProjectName] = useState<string>("Loading Project...");
  const [floorState, setFloorState] = useState<OfficeFloorState | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [approvalComments, setApprovalComments] = useState("");
  const [isSubmittingApproval, setIsSubmittingApproval] = useState(false);

  useEffect(() => {
    const token = getStoredSessionToken();
    if (!token) {
      navigate({ to: "/login" });
      return;
    }

    async function initProject() {
      try {
        let currentId = projectId;
        const projects = await listProjects(token);
        if (projects.length === 0) {
          setIsLoading(false);
          return;
        }

        if (!currentId || !projects.some((p) => p.id === currentId)) {
          currentId = projects[0].id;
          setProjectId(currentId);
          window.sessionStorage.setItem("helix_active_project_id", currentId);
        }

        const proj = projects.find((p) => p.id === currentId) || projects[0];
        setProjectName(proj.name);

        const office = await getProjectOffice(currentId, token);
        setFloorState(office);

        // If no active workflow, start one automatically
        if (!office.hasActiveWorkflow) {
          await startProjectWorkflow(currentId, token);
          const refreshed = await getProjectOffice(currentId, token);
          setFloorState(refreshed);
        }
      } catch (err) {
        console.error("Failed to load office state:", err);
      } finally {
        setIsLoading(false);
      }
    }

    void initProject();

    // Poll for live agent progress every 3 seconds
    const interval = setInterval(async () => {
      const activeToken = getStoredSessionToken();
      if (!activeToken || !projectId) return;
      try {
        const state = await getProjectOffice(projectId, activeToken);
        setFloorState(state);
      } catch {
        // Suppress transient polling errors
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [projectId, navigate]);

  async function handleApproval(approved: boolean) {
    if (!floorState?.workflowId || !floorState.currentCheckpoint) return;
    const token = getStoredSessionToken();
    if (!token) return;

    setIsSubmittingApproval(true);
    try {
      await approveWorkflowCheckpoint(
        floorState.workflowId,
        floorState.currentCheckpoint.checkpointType,
        approved,
        approvalComments,
        token,
      );
      toast.success(approved ? "Checkpoint approved! Resuming workforce." : "Checkpoint rejected.");
      setApprovalComments("");
      const refreshed = await getProjectOffice(projectId!, token);
      setFloorState(refreshed);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to submit approval");
    } finally {
      setIsSubmittingApproval(false);
    }
  }

  const pmAgent = floorState?.agents.find((a) => a.role === "product_manager");
  const otherAgents = floorState?.agents.filter((a) => a.role !== "product_manager") || [];

  return (
    <AppShell
      title="AI Engineering Office"
      subtitle={`Your 9-agent engineering team is building: ${projectName}`}
      action={
        <Button asChild variant="outline">
          <Link to="/office/tasks">
            <Maximize2 className="mr-1.5 h-4 w-4" /> Task Flow &amp; Artifacts
          </Link>
        </Button>
      }
    >
      {/* Human Approval Checkpoint Banner */}
      {floorState?.currentCheckpoint && (
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
                <span className="text-xs text-muted-foreground">
                  Required before proceeding
                </span>
              </div>
              <h3 className="mt-1 text-base font-semibold">
                {floorState.currentCheckpoint.title}
              </h3>
              <p className="mt-1 text-sm text-muted-foreground">
                {floorState.currentCheckpoint.summary}
              </p>

              <div className="mt-3">
                <Textarea
                  placeholder="Review comments or change requests (optional)..."
                  value={approvalComments}
                  onChange={(e) => setApprovalComments(e.target.value)}
                  className="max-w-xl text-xs"
                  rows={2}
                />
              </div>

              <div className="mt-3 flex items-center gap-3">
                <Button
                  size="sm"
                  onClick={() => void handleApproval(true)}
                  disabled={isSubmittingApproval}
                >
                  <CheckCircle2 className="mr-1.5 h-4 w-4" /> Approve &amp; Continue
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="text-destructive hover:bg-destructive/10"
                  onClick={() => void handleApproval(false)}
                  disabled={isSubmittingApproval}
                >
                  <XCircle className="mr-1.5 h-4 w-4" /> Reject / Request Revision
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="grid gap-5 xl:grid-cols-[1.6fr_1fr]">
        <Panel
          title="Live Engineering Floor"
          description={`Workforce Status: ${floorState?.workflowStatus?.toUpperCase() || "IDLE"}`}
        >
          {/* PM Agent Spotlight */}
          <div className="rounded-xl border border-border bg-muted/40 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className="flex h-12 w-12 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
                  PM
                </span>
                <div>
                  <p className="text-sm font-semibold">{pmAgent?.name || "Product Manager AI"}</p>
                  <p className="text-xs text-muted-foreground">{pmAgent?.currentTask || "Planning & Orchestration"}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <StatusPill tone={pmAgent?.status === "done" ? "done" : pmAgent?.status === "working" ? "working" : "queued"}>
                  {statusLabel[pmAgent?.status || "working"]}
                </StatusPill>
              </div>
            </div>
            <div className="mt-3 flex items-center gap-2">
              <Meter value={pmAgent?.progress || 0} />
              <span className="text-xs tabular-nums text-muted-foreground">{pmAgent?.progress || 0}%</span>
            </div>
          </div>

          {/* 8 Specialized Agents Grid */}
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {otherAgents.map((a) => (
              <div key={a.id || a.role} className="rounded-xl border border-border bg-card p-3">
                <div className="flex items-center justify-between">
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-accent text-[11px] font-semibold text-accent-foreground">
                    {a.initials}
                  </span>
                  <StatusPill tone={a.status === "done" ? "done" : a.status === "working" ? "working" : a.status === "awaiting_approval" ? "queued" : "idle"}>
                    {statusLabel[a.status] || a.status}
                  </StatusPill>
                </div>
                <p className="mt-2 text-xs font-semibold">{a.name}</p>
                <p className="text-[11px] text-muted-foreground truncate" title={a.currentTask}>
                  {a.currentTask}
                </p>
                <div className="mt-3 flex items-center gap-2">
                  <Meter value={a.progress} />
                  <span className="text-[11px] tabular-nums text-muted-foreground">
                    {a.progress}%
                  </span>
                </div>
              </div>
            ))}
          </div>
        </Panel>

        {/* Live Activity & Stream */}
        <Panel title="Task Dependency Status" description="Live coordination across all nine agents">
          <ul className="space-y-3">
            {(floorState?.tasks || []).map((t) => (
              <li key={t.id} className="flex items-start gap-3 rounded-lg border border-border p-2.5">
                <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent text-[10px] font-bold">
                  {t.agent.slice(0, 2).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold truncate">{t.task}</p>
                    <span className="text-[10px] text-muted-foreground tabular-nums">
                      {t.progress}%
                    </span>
                  </div>
                  <p className="text-[11px] text-muted-foreground">{t.agent}</p>
                  {t.summary && (
                    <p className="mt-1 text-[11px] text-foreground/80 bg-muted/30 rounded p-1">
                      {t.summary}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ul>

          <Button asChild variant="outline" className="mt-5 w-full">
            <Link to="/office/tasks">View Full Task Artifacts &amp; Files</Link>
          </Button>
        </Panel>
      </div>
    </AppShell>
  );
}
