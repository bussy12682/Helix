import { createFileRoute, Link } from "@tanstack/react-router";
import { ShieldAlert, ShieldCheck } from "lucide-react";

import { AppShell, Panel, StatusPill } from "@/components/helix/app-shell";
import {
  ProviderBadge,
  SeverityPill,
  taskStatusLabel,
  taskTone,
} from "@/components/helix/workflow-ui";
import { Button } from "@/components/ui/button";
import type { AgentRisk } from "@/lib/api";
import { useActiveProject } from "@/lib/use-active-project";
import { useWorkflowStream } from "@/lib/use-workflow-stream";

export const Route = createFileRoute("/security")({
  head: () => ({
    meta: [
      { title: "Security Review — HELIX" },
      {
        name: "description",
        content: "Threat model and findings produced by the Security Engineer AI for your project.",
      },
      { property: "og:title", content: "Security Review — HELIX" },
      { property: "og:description", content: "Security findings from your AI workforce." },
    ],
  }),
  component: Security,
});

const severityOrder: Record<AgentRisk["severity"], number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

function Security() {
  const { project, projectId } = useActiveProject();
  const { floorState, artifacts } = useWorkflowStream(projectId, { withArtifacts: true });

  const securityTask = floorState?.tasks.find((t) => t.role === "security_engineer");
  const allRisks = (floorState?.tasks ?? []).flatMap((t) =>
    (t.risks ?? []).map((r) => ({ ...r, source: t.agent })),
  );
  const risks = [...allRisks].sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);
  const securityArtifacts = artifacts.filter((a) => a.createdBy === "security_engineer");
  const counts = risks.reduce<Record<string, number>>(
    (acc, r) => ({ ...acc, [r.severity]: (acc[r.severity] ?? 0) + 1 }),
    {},
  );

  return (
    <AppShell
      title="Security Review"
      subtitle={
        project ? `Findings for ${project.name}` : "Security findings from your AI workforce"
      }
      action={
        <Button asChild variant="outline">
          <Link to="/office">Open AI Office</Link>
        </Button>
      }
    >
      <div className="grid gap-5 xl:grid-cols-[380px_1fr]">
        <Panel title="Security Engineer AI" description="Threat modeling & review task">
          {!securityTask ? (
            <p className="text-sm text-muted-foreground">
              No workflow has run for this project yet.
            </p>
          ) : (
            <div className="space-y-3 text-sm">
              <div className="flex items-center gap-2">
                <StatusPill tone={taskTone(securityTask.status)}>
                  {taskStatusLabel[securityTask.status]}
                </StatusPill>
                <ProviderBadge
                  provider={securityTask.provider}
                  model={securityTask.model}
                  simulated={securityTask.simulated}
                />
              </div>
              <p className="text-muted-foreground">
                {securityTask.summary ?? "The review runs after the Backend Engineer finishes."}
              </p>
              {(floorState?.reviewLoopCount ?? 0) > 0 && (
                <p className="text-xs">
                  Automated remediation loops triggered:{" "}
                  <span className="font-semibold">{floorState?.reviewLoopCount}</span>
                </p>
              )}
              <div className="grid grid-cols-4 gap-2 pt-2 text-center">
                {(["critical", "high", "medium", "low"] as const).map((s) => (
                  <div key={s} className="rounded-lg border border-border p-2">
                    <p className="font-display text-xl font-bold tabular-nums">{counts[s] ?? 0}</p>
                    <p className="text-[10px] uppercase text-muted-foreground">{s}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Panel>

        <div className="space-y-5">
          <Panel title="Findings" description="Risks reported by all agents, most severe first">
            {risks.length === 0 ? (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <ShieldCheck className="h-4 w-4" /> No risks reported yet.
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {risks.map((r, i) => (
                  <li key={`${r.source}-${i}`} className="flex items-start gap-3 py-3">
                    <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm">{r.description}</p>
                      <p className="text-xs text-muted-foreground">{r.source}</p>
                    </div>
                    <SeverityPill severity={r.severity} />
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel
            title="Security artifacts"
            description="Documents generated by the Security Engineer AI"
          >
            {securityArtifacts.length === 0 ? (
              <p className="text-sm text-muted-foreground">None yet.</p>
            ) : (
              securityArtifacts.map((a) => (
                <details key={a.path} className="mb-2 rounded-lg border border-border p-3">
                  <summary className="cursor-pointer text-sm font-medium">
                    {a.name} <span className="text-xs text-muted-foreground">v{a.version}</span>
                  </summary>
                  <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap font-mono text-xs">
                    {a.content}
                  </pre>
                </details>
              ))
            )}
          </Panel>
        </div>
      </div>
    </AppShell>
  );
}
