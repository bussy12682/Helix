import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Code2, FileCode, FileText, Eye, CheckCircle2 } from "lucide-react";
import { useEffect, useState } from "react";

import { AppShell, Meter, Panel, StatusPill } from "@/components/helix/app-shell";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  getProjectArtifacts,
  getProjectOffice,
  getStoredSessionToken,
  listProjects,
  type OfficeFloorState,
} from "@/lib/api";

export const Route = createFileRoute("/office/tasks")({
  head: () => ({
    meta: [
      { title: "Task Assignment Flow & Artifacts — HELIX" },
      { name: "description", content: "See how the Project Manager AI assigns and tracks every task across your agents and view generated artifacts." },
      { property: "og:title", content: "Task Assignment Flow & Artifacts — HELIX" },
      { property: "og:description", content: "Live task log and generated files across all nine agents." },
    ],
  }),
  component: TaskFlow,
});

type Artifact = {
  name: string;
  type: string;
  path: string;
  content: string;
  version: number;
};

function TaskFlow() {
  const navigate = useNavigate();
  const [projectId, setProjectId] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return window.sessionStorage.getItem("helix_active_project_id");
  });
  const [floorState, setFloorState] = useState<OfficeFloorState | null>(null);
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [selectedArtifact, setSelectedArtifact] = useState<Artifact | null>(null);

  useEffect(() => {
    const token = getStoredSessionToken();
    if (!token) {
      navigate({ to: "/login" });
      return;
    }

    async function loadData() {
      try {
        let currentId = projectId;
        if (!currentId) {
          const projects = await listProjects(token);
          if (projects.length > 0) {
            currentId = projects[0].id;
            setProjectId(currentId);
            window.sessionStorage.setItem("helix_active_project_id", currentId);
          }
        }

        if (currentId) {
          const [office, arts] = await Promise.all([
            getProjectOffice(currentId, token),
            getProjectArtifacts(currentId, token),
          ]);
          setFloorState(office);
          setArtifacts(arts.artifacts || []);
          if (arts.artifacts && arts.artifacts.length > 0 && !selectedArtifact) {
            setSelectedArtifact(arts.artifacts[0]);
          }
        }
      } catch (err) {
        console.error("Failed to load task flow:", err);
      }
    }

    void loadData();

    const interval = setInterval(async () => {
      const activeToken = getStoredSessionToken();
      if (!activeToken || !projectId) return;
      try {
        const [office, arts] = await Promise.all([
          getProjectOffice(projectId, activeToken),
          getProjectArtifacts(projectId, activeToken),
        ]);
        setFloorState(office);
        setArtifacts(arts.artifacts || []);
      } catch {
        // Suppress polling errors
      }
    }, 4000);

    return () => clearInterval(interval);
  }, [projectId, navigate]);

  return (
    <AppShell
      title="Task Assignment Flow &amp; Artifacts"
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
                    <TableCell className="text-xs font-semibold">{t.agent}</TableCell>
                    <TableCell>
                      <p className="text-xs font-medium">{t.task}</p>
                      {t.summary && <p className="mt-0.5 text-[11px] text-muted-foreground">{t.summary}</p>}
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
                      <StatusPill tone={t.status === "completed" ? "done" : t.status === "running" ? "working" : t.status === "awaiting_approval" ? "queued" : "idle"}>
                        {t.status === "completed"
                          ? "Done"
                          : t.status === "running"
                            ? "Working"
                            : t.status === "awaiting_approval"
                              ? "Approval"
                              : "Queued"}
                      </StatusPill>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Panel>

          {/* Generated Artifacts Section */}
          <Panel title="Generated Engineering Artifacts" description="Files created by the specialized agents in the virtual workspace">
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
                    onClick={() => setSelectedArtifact(art)}
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
          description={selectedArtifact ? `${selectedArtifact.path} (v${selectedArtifact.version})` : "Select a generated file to inspect"}
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
