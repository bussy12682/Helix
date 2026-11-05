import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, Code2, FileCode, FileText } from "lucide-react";
import { useEffect, useState } from "react";

import { AppShell, Meter, Panel, StatusPill } from "@/components/helix/app-shell";
import { ProviderBadge, taskStatusLabel, taskTone } from "@/components/helix/workflow-ui";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getStoredSessionToken, getWorkflowTraces, type Artifact, type TraceSpan } from "@/lib/api";
import { useActiveProject } from "@/lib/use-active-project";
import { useWorkflowStream } from "@/lib/use-workflow-stream";

export const Route = createFileRoute("/office/tasks")({
  head: () => ({
    meta: [
      { title: "Task Assignment Flow & Artifacts — HELIX" },
      {
        name: "description",
        content:
          "See how the Project Manager AI assigns and tracks every task across your agents and view generated artifacts.",
      },
      { property: "og:title", content: "Task Assignment Flow & Artifacts — HELIX" },
      {
        property: "og:description",
        content: "Live task log and generated files across all nine agents.",
      },
    ],
  }),
  component: TaskFlow,
});

function TaskFlow() {
  const { projectId } = useActiveProject();
  const { floorState, artifacts } = useWorkflowStream(projectId, { withArtifacts: true });
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [traces, setTraces] = useState<TraceSpan[]>([]);
  const selectedArtifact: Artifact | null =
    artifacts.find((a) => a.path === selectedPath) ?? artifacts[0] ?? null;
  const completedCount = floorState?.tasks.filter((t) => t.status === "completed").length ?? 0;

  useEffect(() => {
    const token = getStoredSessionToken();
    const workflowId = floorState?.workflowId;
    if (!token || !workflowId) return;
    getWorkflowTraces(workflowId, token)
      .then((res) => setTraces(res.traces))
      .catch(() => setTraces([]));
  }, [floorState?.workflowId, completedCount]);

  return (
    <AppShell
      title="Task Assignment Flow & Artifacts"
      subtitle="Coordinated execution log and generated files across all 9 agents"
      action={
        <Button asChild variant="outline">
          <Link to="/office">
            <ArrowLeft className="mr-1.5 h-4 w-4" /> Back to Office
          </Link>
        </Button>
      }
    >
      <div className="grid gap-5 xl:grid-cols-[1.4fr_1fr]">
        <div className="space-y-5">
          <Panel title="Live Task Pipeline" description="Ordered by topological DAG dependencies">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Agent</TableHead>
                  <TableHead>Engineering Task</TableHead>
                  <TableHead className="w-32">Progress</TableHead>
                  <TableHead className="w-28">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(floorState?.tasks || []).map((t) => (
                  <TableRow key={t.id}>
                    <TableCell className="text-xs font-semibold">
                      {t.agent}
                      <div className="mt-1">
                        <ProviderBadge
                          provider={t.provider}
                          model={t.model}
                          simulated={t.simulated}
                        />
                      </div>
                    </TableCell>
                    <TableCell>
                      <p className="text-xs font-medium">{t.task}</p>
                      {t.summary && (
                        <p className="mt-0.5 text-[11px] text-muted-foreground">{t.summary}</p>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Meter value={t.progress} />
                        <span className="text-[11px] tabular-nums text-muted-foreground">
                          {t.progress}%
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <StatusPill tone={taskTone(t.status)}>
                        {taskStatusLabel[t.status] ?? t.status}
                      </StatusPill>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Panel>

          <Panel
            title="Execution Traces"
            description="Recorded model calls per agent (provider, latency, tokens)"
          >
            {traces.length === 0 ? (
              <p className="text-xs text-muted-foreground">No agent executions recorded yet.</p>
            ) : (
              <ul className="divide-y divide-border">
                {traces.map((span) => (
                  <li key={span.spanId} className="flex flex-wrap items-center gap-2 py-2 text-xs">
                    <span className="font-semibold">{span.agentRole.replace(/_/g, " ")}</span>
                    <StatusPill tone={span.status === "completed" ? "done" : "danger"}>
                      {span.status}
                    </StatusPill>
                    <ProviderBadge
                      provider={span.provider}
                      model={span.model}
                      simulated={span.provider === "mock"}
                    />
                    <span className="tabular-nums text-muted-foreground">
                      {(span.durationMs / 1000).toFixed(1)}s
                    </span>
                    {span.usage?.total_tokens ? (
                      <span className="tabular-nums text-muted-foreground">
                        {span.usage.total_tokens} tokens
                      </span>
                    ) : null}
                    {span.error && (
                      <span className="w-full break-words text-destructive">{span.error}</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          {/* Generated Artifacts Section */}
          <Panel
            title="Generated Engineering Artifacts"
            description="Files created by the specialized agents in the virtual workspace"
          >
            {artifacts.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No artifacts generated yet. They will appear here as agents complete their tasks.
              </p>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2">
                {artifacts.map((art) => (
                  <button
                    key={art.path}
                    type="button"
                    onClick={() => setSelectedPath(art.path)}
                    className={`flex items-start gap-2.5 rounded-lg border p-2.5 text-left transition-colors ${
                      selectedArtifact?.path === art.path
                        ? "border-primary bg-primary/5"
                        : "border-border hover:bg-muted/40"
                    }`}
                  >
                    <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded bg-accent text-accent-foreground">
                      {art.type === "code" ? (
                        <Code2 className="h-4 w-4" />
                      ) : (
                        <FileText className="h-4 w-4" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-semibold">{art.name}</p>
                      <p className="truncate text-[10px] text-muted-foreground">{art.path}</p>
                      <span className="mt-1 inline-block text-[9px] uppercase tracking-wider text-primary font-bold">
                        v{art.version} · {art.type}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </Panel>
        </div>

        {/* Selected Artifact Code/Spec Viewer */}
        <Panel
          title={selectedArtifact ? selectedArtifact.name : "Artifact Viewer"}
          description={
            selectedArtifact
              ? `${selectedArtifact.path} (v${selectedArtifact.version})`
              : "Select a generated file to inspect"
          }
        >
          {selectedArtifact ? (
            <div className="space-y-3">
              <div className="max-h-[600px] overflow-auto rounded-lg border border-border bg-muted/20 p-3">
                <pre className="font-mono text-xs whitespace-pre-wrap text-foreground/90 leading-relaxed">
                  {selectedArtifact.content}
                </pre>
              </div>
            </div>
          ) : (
            <div className="flex h-64 flex-col items-center justify-center rounded-lg border border-dashed border-border p-6 text-center text-muted-foreground">
              <FileCode className="h-8 w-8 mb-2 opacity-50" />
              <p className="text-xs">Click any artifact on the left to inspect the code or spec.</p>
            </div>
          )}
        </Panel>
      </div>
    </AppShell>
  );
}
