import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
  Bot,
  Box,
  Hammer,
  CircleStop,
  Download,
  FileCode2,
  FilePlus2,
  FolderOpen,
  Play,
  RefreshCw,
  Save,
  SquareTerminal,
  TestTube2,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { AppShell, Panel, StatusPill } from "@/components/helix/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  buildWorkspaceApplication,
  deleteWorkspaceFile,
  executeWorkspaceCommand,
  getProject,
  getStoredSessionToken,
  installWorkspaceDependencies,
  listExecutionJobs,
  listProjects,
  listWorkspaceFiles,
  proposeWorkspaceRepair,
  readWorkspaceFile,
  resolveApiUrl,
  runWorkspaceTests,
  saveWorkspaceFile,
  startWorkspacePreview,
  stopExecutionJob,
  stopWorkspacePreview,
  subscribeToExecutionEvents,
  subscribeToProjectEvents,
  type ExecutionJob,
  type ExecutionStatus,
  type PreviewState,
  type Project,
  type RepairProposal,
  type WorkspaceFile,
} from "@/lib/api";

export const Route = createFileRoute("/projects/workspace")({
  validateSearch: (search: Record<string, unknown>): { projectId?: string } => {
    const projectId = search["projectId"];
    return typeof projectId === "string" ? { projectId } : {};
  },
  head: () => ({ meta: [{ title: "Workspace — HELIX" }] }),
  component: Workspace,
});

type LoadedFile = WorkspaceFile & { content: string; createdBy?: string };
type TerminalChunk = { id: number; jobId: string; stream: string; data: string };

function jobTone(job: ExecutionJob | null) {
  if (!job) return "idle" as const;
  if (job.status === "completed") return "done" as const;
  if (["failed", "unavailable"].includes(job.status)) return "danger" as const;
  if (["running", "stopping"].includes(job.status)) return "working" as const;
  return "queued" as const;
}

function Workspace() {
  const navigate = useNavigate();
  const { projectId: searchedProjectId } = Route.useSearch();
  const [projectId, setProjectId] = useState<string | null>(null);
  const [project, setProject] = useState<Project | null>(null);
  const [availableProjects, setAvailableProjects] = useState<Array<Pick<Project, "id" | "name">>>([]);
  const [files, setFiles] = useState<WorkspaceFile[]>([]);
  const [selected, setSelected] = useState<LoadedFile | null>(null);
  const [draft, setDraft] = useState("");
  const [newFilePath, setNewFilePath] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [execution, setExecution] = useState<ExecutionStatus | null>(null);
  const [jobs, setJobs] = useState<ExecutionJob[]>([]);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [connected, setConnected] = useState(false);
  const [terminalChunks, setTerminalChunks] = useState<TerminalChunk[]>([]);
  const [command, setCommand] = useState("node --version");
  const [tab, setTab] = useState<"editor" | "terminal" | "preview">("editor");
  const [repair, setRepair] = useState<RepairProposal | null>(null);
  const [repairing, setRepairing] = useState(false);
  const [previewRevision, setPreviewRevision] = useState(0);
  const chunkId = useRef(0);
  const terminalEnd = useRef<HTMLDivElement>(null);

  const dirty = selected ? draft !== selected.content : false;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const activeJob = jobs.find((job) => job.id === activeJobId) ?? null;
  const latestFailed = activeJob?.status === "failed"
    ? activeJob
    : jobs.find((job) => job.status === "failed" && job.result) ?? null;

  const tokenOrRedirect = useCallback(() => {
    const token = getStoredSessionToken();
    if (!token) {
      void navigate({ to: "/login" });
      return null;
    }
    return token;
  }, [navigate]);

  const refreshFiles = useCallback(async (id: string) => {
    const token = tokenOrRedirect();
    if (!token) return;
    const response = await listWorkspaceFiles(id, token);
    setFiles(response.files);
    setExecution(response.execution);
  }, [tokenOrRedirect]);

  const refreshJobs = useCallback(async (id: string) => {
    const token = tokenOrRedirect();
    if (!token) return;
    const response = await listExecutionJobs(id, token);
    setJobs(response.jobs);
    setPreview(response.preview);
    setExecution(response.execution);
  }, [tokenOrRedirect]);

  const openFile = useCallback(async (id: string, filePath: string, confirmDiscard = false) => {
    if (confirmDiscard && dirtyRef.current && !window.confirm("Discard unsaved changes in the current file?")) return;
    const token = tokenOrRedirect();
    if (!token) return;
    try {
      const response = await readWorkspaceFile(id, filePath, token);
      setSelected(response.file);
      setDraft(response.file.content);
      setError("");
    } catch (requestError) {
      toast.error(requestError instanceof Error ? requestError.message : "Could not open the file");
    }
  }, [tokenOrRedirect]);

  useEffect(() => {
    const id = searchedProjectId || window.sessionStorage.getItem("helix_active_project_id");
    setProjectId(id);
    if (id) window.sessionStorage.setItem("helix_active_project_id", id);
  }, [searchedProjectId]);

  useEffect(() => {
    const token = tokenOrRedirect();
    if (!token) return;
    if (!projectId) {
      setLoading(true);
      listProjects(token)
        .then((projects) => setAvailableProjects(projects))
        .catch((requestError) => setError(requestError instanceof Error ? requestError.message : "Could not load projects"))
        .finally(() => setLoading(false));
      return;
    }
    setLoading(true);
    setSelected(null);
    setDraft("");
    setTerminalChunks([]);
    setRepair(null);
    Promise.all([getProject(projectId, token), listWorkspaceFiles(projectId, token), listExecutionJobs(projectId, token)])
      .then(async ([projectData, fileData, executionData]) => {
        setProject(projectData);
        setFiles(fileData.files);
        setExecution(fileData.execution);
        setJobs(executionData.jobs);
        setPreview(executionData.preview);
        const preferred = fileData.files.find((file) => file.path === "package.json") ?? fileData.files[0];
        if (preferred) await openFile(projectId, preferred.path);
      })
      .catch((requestError) => setError(requestError instanceof Error ? requestError.message : "Could not load the workspace"))
      .finally(() => setLoading(false));
  }, [projectId, openFile, tokenOrRedirect]);

  useEffect(() => {
    if (!projectId) return;
    const token = tokenOrRedirect();
    if (!token) return;
    const upsertJob = (job: ExecutionJob) => {
      setJobs((current) => [job, ...current.filter((candidate) => candidate.id !== job.id)].slice(0, 100));
    };
    const unsubscribeExecution = subscribeToExecutionEvents(projectId, token, {
      onStatus: setConnected,
      onEvent: (event) => {
        if (event.type === "execution_snapshot") {
          if (event.payload?.jobs) setJobs(event.payload.jobs);
          if (event.payload?.preview !== undefined) setPreview(event.payload.preview ?? null);
          return;
        }
        if (event.payload?.job) upsertJob(event.payload.job);
        if (event.type === "execution_output" && event.payload?.job && event.payload.data) {
          const chunk = {
            id: ++chunkId.current,
            jobId: event.payload.job.id,
            stream: event.payload.stream ?? "stdout",
            data: event.payload.data,
          };
          setTerminalChunks((current) => [...current, chunk].slice(-600));
        }
        if (event.type === "execution_completed" && event.payload?.job?.kind === "install") {
          void refreshFiles(projectId);
        }
        if (event.payload?.preview !== undefined) setPreview(event.payload.preview ?? null);
      },
    });
    const unsubscribeWorkflow = subscribeToProjectEvents(projectId, token, {
      onEvent: (event) => {
        if (event.type === "task_completed") void refreshFiles(projectId);
      },
    });
    const poll = window.setInterval(() => void refreshJobs(projectId).catch(() => {}), 10000);
    return () => {
      unsubscribeExecution();
      unsubscribeWorkflow();
      window.clearInterval(poll);
    };
  }, [projectId, refreshFiles, refreshJobs, tokenOrRedirect]);

  useEffect(() => {
    terminalEnd.current?.scrollIntoView({ block: "nearest" });
  }, [terminalChunks, activeJobId, tab]);

  const visibleChunks = useMemo(
    () => terminalChunks.filter((chunk) => !activeJobId || chunk.jobId === activeJobId),
    [terminalChunks, activeJobId],
  );

  async function saveCurrent() {
    if (!projectId || !selected) return;
    const token = tokenOrRedirect();
    if (!token) return;
    setSaving(true);
    try {
      const response = await saveWorkspaceFile(projectId, selected.path, draft, token, selected.version);
      setSelected(response.file);
      setDraft(response.file.content);
      await refreshFiles(projectId);
      toast.success(`Saved ${selected.path}`);
    } catch (requestError) {
      toast.error(requestError instanceof Error ? requestError.message : "Could not save the file");
    } finally {
      setSaving(false);
    }
  }

  async function createFile() {
    if (!projectId || !newFilePath.trim()) return;
    if (files.some((file) => file.path === newFilePath.trim())) {
      toast.error("That file already exists. Select it in the explorer instead.");
      return;
    }
    const token = tokenOrRedirect();
    if (!token) return;
    try {
      const response = await saveWorkspaceFile(projectId, newFilePath.trim(), "", token);
      setNewFilePath("");
      await refreshFiles(projectId);
      setSelected(response.file);
      setDraft("");
      toast.success(`Created ${response.file.path}`);
    } catch (requestError) {
      toast.error(requestError instanceof Error ? requestError.message : "Could not create the file");
    }
  }

  async function removeSelected() {
    if (!projectId || !selected || !window.confirm(`Delete ${selected.path}?`)) return;
    const token = tokenOrRedirect();
    if (!token) return;
    try {
      await deleteWorkspaceFile(projectId, selected.path, token);
      const deletedPath = selected.path;
      setSelected(null);
      setDraft("");
      await refreshFiles(projectId);
      toast.success(`Deleted ${deletedPath}`);
    } catch (requestError) {
      toast.error(requestError instanceof Error ? requestError.message : "Could not delete the file");
    }
  }

  async function startAction(action: () => Promise<{ job: ExecutionJob }>, nextTab = false) {
    try {
      const response = await action();
      setActiveJobId(response.job.id);
      setJobs((current) => [response.job, ...current.filter((job) => job.id !== response.job.id)]);
      if (nextTab) setTab("terminal");
    } catch (requestError) {
      toast.error(requestError instanceof Error ? requestError.message : "Could not start the operation");
    }
  }

  async function runCommand() {
    if (!projectId || !command.trim()) return;
    const token = tokenOrRedirect();
    if (!token) return;
    const value = command.trim();
    await startAction(() => executeWorkspaceCommand(projectId, value, token), true);
  }

  async function startPreview() {
    if (!projectId) return;
    setTab("preview");
    if (preview?.status === "ready") {
      setPreviewRevision((value) => value + 1);
      return;
    }
    const token = tokenOrRedirect();
    if (!token) return;
    setTab("preview");
    try {
      const response = await startWorkspacePreview(projectId, token);
      setPreview(response.preview);
      if (response.preview.status === "ready") {
        setPreviewRevision((value) => value + 1);
        toast.success("Live application preview is ready");
      } else {
        toast.error(response.preview.error || "Preview did not start");
      }
    } catch (requestError) {
      toast.error(requestError instanceof Error ? requestError.message : "Preview could not start");
      await refreshJobs(projectId);
    }
  }

  async function requestRepair() {
    if (!projectId || !latestFailed) {
      toast.error("Run a command first; AI repair needs a real failed execution log.");
      return;
    }
    const token = tokenOrRedirect();
    if (!token) return;
    setRepairing(true);
    try {
      const proposal = await proposeWorkspaceRepair(projectId, latestFailed.id, selected?.path ?? null, token);
      setRepair(proposal);
      if (proposal.simulated) toast.warning("Offline AI draft only. Review carefully; this repair has not run.");
      else toast.success("AI proposed an unverified repair. Review it before applying.");
    } catch (requestError) {
      toast.error(requestError instanceof Error ? requestError.message : "AI repair failed");
    } finally {
      setRepairing(false);
    }
  }

  async function applyRepairFile(file: RepairProposal["files"][number]) {
    if (!projectId) return;
    const token = tokenOrRedirect();
    if (!token) return;
    try {
      const existing = await readWorkspaceFile(projectId, file.path, token).catch(() => null);
      const response = await saveWorkspaceFile(projectId, file.path, file.content, token, existing?.file.version);
      await refreshFiles(projectId);
      setSelected(response.file);
      setDraft(response.file.content);
      setTab("editor");
      toast.success(`Applied proposal to ${file.path}; run tests to verify it.`);
    } catch (requestError) {
      toast.error(requestError instanceof Error ? requestError.message : "Could not apply the proposal");
    }
  }

  if (!projectId) {
    return (
      <AppShell title="Workspace" subtitle="Choose a project to edit and run">
        <Panel title="Project workspaces" description="Files and execution are isolated per project.">
          {loading ? <p className="text-sm text-muted-foreground">Loading projects…</p> : error ? (
            <p role="alert" className="text-sm text-destructive">{error}</p>
          ) : availableProjects.length ? (
            <div className="grid gap-3 md:grid-cols-2">
              {availableProjects.map((item) => (
                <Button key={item.id} asChild variant="outline" className="h-auto justify-start p-4">
                  <Link to="/projects/workspace" search={{ projectId: item.id }}>
                    <FolderOpen className="mr-2 h-4 w-4" />{item.name}
                  </Link>
                </Button>
              ))}
            </div>
          ) : (
            <Button asChild><Link to="/projects/new">Create a project</Link></Button>
          )}
        </Panel>
      </AppShell>
    );
  }

  return (
    <AppShell
      title={project?.name ?? "Workspace"}
      subtitle="Edit source, run real commands, and inspect the live application"
      action={
        <div className="flex items-center gap-2">
          <Badge variant="outline" className={connected ? "border-success/40 text-success" : "border-warning/40"}>
            {connected ? "Live logs" : "Reconnecting / polling"}
          </Badge>
          <Button asChild variant="outline" size="sm"><Link to="/office">AI Office</Link></Button>
        </div>
      }
    >
      {error ? <div role="alert" className="mb-4 rounded-lg border border-destructive/40 p-3 text-sm text-destructive">{error}</div> : null}
      {execution && !execution.available ? (
        <div role="alert" className="mb-4 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm">
          Secure execution is unavailable: {execution.reason ?? "Bubblewrap isolation could not be initialized"}. Static file editing remains available.
        </div>
      ) : null}

      <div className="mb-4 flex flex-wrap gap-2">
        <Button size="sm" variant="outline" disabled={!execution?.available} onClick={() => {
          const token = tokenOrRedirect();
          if (token && projectId) void startAction(() => installWorkspaceDependencies(projectId, token), true);
        }}><Download className="mr-1.5 h-4 w-4" />Install</Button>
        <Button size="sm" variant="outline" disabled={!execution?.available} onClick={() => {
          const token = tokenOrRedirect();
          if (token && projectId) void startAction(() => runWorkspaceTests(projectId, token), true);
        }}><TestTube2 className="mr-1.5 h-4 w-4" />Run tests</Button>
        <Button size="sm" variant="outline" disabled={!execution?.available} onClick={() => {
          const token = tokenOrRedirect();
          if (token && projectId) void startAction(() => buildWorkspaceApplication(projectId, token), true);
        }}><Hammer className="mr-1.5 h-4 w-4" />Build</Button>
        <Button size="sm" onClick={() => void startPreview()} disabled={preview?.status === "starting"}>
          <Play className="mr-1.5 h-4 w-4" />{preview?.status === "ready" ? "Refresh preview" : "Run application"}
        </Button>
        {preview && ["ready", "starting"].includes(preview.status) ? (
          <Button size="sm" variant="outline" onClick={() => {
            const token = tokenOrRedirect();
            if (token && projectId) void stopWorkspacePreview(projectId, token).then((response) => setPreview(response.preview)).catch((requestError) => toast.error(requestError.message));
          }}><CircleStop className="mr-1.5 h-4 w-4" />Stop preview</Button>
        ) : null}
        <Button size="sm" variant="outline" disabled={repairing || !latestFailed} onClick={() => void requestRepair()}>
          <Bot className="mr-1.5 h-4 w-4" />{repairing ? "Requesting repair…" : "AI repair"}
        </Button>
      </div>

      <div className="grid min-h-[680px] gap-4 xl:grid-cols-[250px_minmax(0,1fr)]">
        <Panel title="Files" description={`${files.length} saved workspace files`} className="min-h-0">
          <div className="mb-3 flex gap-2">
            <Input aria-label="New file path" placeholder="src/file.js" value={newFilePath} onChange={(event) => setNewFilePath(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void createFile(); }} />
            <Button size="icon" variant="outline" aria-label="Create file" onClick={() => void createFile()}><FilePlus2 className="h-4 w-4" /></Button>
          </div>
          <div className="max-h-[590px] space-y-1 overflow-y-auto">
            {files.map((file) => (
              <button
                type="button"
                key={file.path}
                onClick={() => void openFile(projectId, file.path, true)}
                className={`flex w-full items-start gap-2 rounded-md px-2 py-2 text-left text-xs transition-colors ${selected?.path === file.path ? "bg-primary/10 text-primary" : "hover:bg-muted"}`}
              >
                <FileCode2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span className="min-w-0 flex-1 break-all">{file.path}</span>
                <span className="text-muted-foreground">v{file.version}</span>
              </button>
            ))}
            {!files.length ? <p className="p-2 text-xs text-muted-foreground">No generated files yet. Create one above or run the nine-agent workflow.</p> : null}
          </div>
        </Panel>

        <section className="min-w-0 rounded-xl border border-border bg-card">
          <div className="flex flex-wrap items-center gap-1 border-b border-border p-2">
            {(["editor", "terminal", "preview"] as const).map((item) => (
              <Button key={item} size="sm" variant={tab === item ? "secondary" : "ghost"} onClick={() => setTab(item)}>
                {item === "editor" ? <FileCode2 className="mr-1.5 h-4 w-4" /> : item === "terminal" ? <SquareTerminal className="mr-1.5 h-4 w-4" /> : <Box className="mr-1.5 h-4 w-4" />}
                {item.charAt(0).toUpperCase() + item.slice(1)}
              </Button>
            ))}
            <div className="flex-1" />
            {activeJob ? <StatusPill tone={jobTone(activeJob)}>{activeJob.kind}: {activeJob.status}</StatusPill> : null}
          </div>

          {tab === "editor" ? (
            <div className="flex min-h-[620px] flex-col">
              {selected ? (
                <>
                  <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2">
                    <span className="min-w-0 flex-1 truncate font-mono text-xs">{selected.path}{dirty ? " •" : ""}</span>
                    <span className="text-xs text-muted-foreground">Version {selected.version}</span>
                    <Button size="sm" variant="ghost" onClick={() => void openFile(projectId, selected.path, true)}><RefreshCw className="h-4 w-4" /></Button>
                    <Button size="sm" variant="ghost" aria-label="Delete file" onClick={() => void removeSelected()}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                    <Button size="sm" disabled={!dirty || saving} onClick={() => void saveCurrent()}><Save className="mr-1.5 h-4 w-4" />{saving ? "Saving…" : "Save"}</Button>
                  </div>
                  <Textarea
                    aria-label={`Editing ${selected.path}`}
                    className="min-h-[560px] flex-1 resize-none rounded-none border-0 bg-[#0c0d14] p-4 font-mono text-sm leading-6 text-zinc-100 focus-visible:ring-0"
                    spellCheck={false}
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if ((event.ctrlKey || event.metaKey) && event.key === "s") {
                        event.preventDefault();
                        void saveCurrent();
                      }
                    }}
                  />
                </>
              ) : (
                <div className="flex flex-1 items-center justify-center p-8 text-center text-sm text-muted-foreground">
                  {loading ? "Loading workspace…" : "Select or create a file to start editing."}
                </div>
              )}
            </div>
          ) : null}

          {tab === "terminal" ? (
            <div className="flex min-h-[620px] flex-col">
              <div className="flex gap-2 border-b border-border p-3">
                <Input aria-label="Terminal command" className="font-mono" value={command} onChange={(event) => setCommand(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void runCommand(); }} placeholder="node index.js" />
                <Button disabled={!execution?.available} onClick={() => void runCommand()}><Play className="mr-1.5 h-4 w-4" />Run</Button>
                {activeJob && ["queued", "running"].includes(activeJob.status) ? (
                  <Button variant="outline" onClick={() => {
                    const token = tokenOrRedirect();
                    if (token && projectId) void stopExecutionJob(projectId, activeJob.id, token).then((response) => setJobs((current) => current.map((job) => job.id === response.job.id ? response.job : job))).catch((requestError) => toast.error(requestError.message));
                  }}><CircleStop className="h-4 w-4" /><span className="sr-only">Stop command</span></Button>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-1 border-b border-border px-3 py-2">
                {jobs.slice(0, 8).map((job) => (
                  <button key={job.id} type="button" onClick={() => setActiveJobId(job.id)} className={`rounded px-2 py-1 text-xs ${activeJobId === job.id ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted"}`}>
                    {job.kind} · {job.status}
                  </button>
                ))}
              </div>
              <div className="min-h-0 flex-1 overflow-auto bg-[#090a10] p-4 font-mono text-xs leading-5 text-zinc-200">
                {visibleChunks.length ? visibleChunks.map((chunk) => (
                  <pre key={chunk.id} className={`whitespace-pre-wrap break-words ${chunk.stream === "stderr" ? "text-red-300" : "text-zinc-200"}`}>{chunk.data}</pre>
                )) : (
                  <div className="text-muted-foreground">
                    {activeJob?.result ? (
                      <>
                        {activeJob.result.stdout ? <pre className="whitespace-pre-wrap">{activeJob.result.stdout}</pre> : null}
                        {activeJob.result.stderr ? <pre className="whitespace-pre-wrap text-red-300">{activeJob.result.stderr}</pre> : null}
                        {activeJob.result.error ? <pre className="whitespace-pre-wrap text-red-300">{activeJob.result.error}</pre> : null}
                      </>
                    ) : "No output for this job yet. Commands accept node, npm, npx, and python3; shell pipelines are not supported."}
                  </div>
                )}
                <div ref={terminalEnd} />
              </div>
              <div className="border-t border-border px-4 py-2 text-xs text-muted-foreground">
                {activeJob?.result ? `Exit ${activeJob.result.exitCode ?? "n/a"} · ${activeJob.result.status} · ${activeJob.result.sandbox?.isolation ?? execution?.isolation ?? "isolation unknown"} · network ${activeJob.result.sandbox?.network ?? "disabled"}` : "Output comes directly from the selected execution job."}
              </div>
            </div>
          ) : null}

          {tab === "preview" ? (
            <div className="flex min-h-[620px] flex-col">
              <div className="flex items-center gap-2 border-b border-border px-4 py-2">
                <span className="flex-1 text-xs text-muted-foreground">{preview ? `${preview.mode} preview · ${preview.status}` : "No application preview running"}</span>
                {preview?.status === "ready" ? <Button size="sm" variant="ghost" aria-label="Refresh preview" onClick={() => setPreviewRevision((value) => value + 1)}><RefreshCw className="h-4 w-4" /></Button> : null}
                <Button size="sm" variant="outline" onClick={() => void startPreview()} disabled={preview?.status === "starting"}><Play className="mr-1.5 h-4 w-4" />Run</Button>
              </div>
              {preview?.status === "ready" && preview.url ? (
                <iframe
                  key={`${preview.id}-${previewRevision}`}
                  title="Running application preview"
                  src={resolveApiUrl(preview.url)}
                  className="min-h-[570px] flex-1 border-0 bg-white"
                  sandbox="allow-scripts allow-forms allow-modals"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
                  <Box className="h-8 w-8 text-muted-foreground" />
                  <p className="max-w-md text-sm text-muted-foreground">
                    {preview?.status === "starting" ? "Waiting for the actual application server to accept connections…" : preview?.error ?? "Run the application to start its real server, or preview a workspace with an index.html file."}
                  </p>
                  {preview?.jobId ? <Button variant="outline" size="sm" onClick={() => { setActiveJobId(preview.jobId); setTab("terminal"); }}>Inspect startup logs</Button> : null}
                </div>
              )}
            </div>
          ) : null}
        </section>
      </div>

      {repair ? (
        <Panel
          title={repair.simulated ? "Offline AI repair draft" : "AI repair proposal"}
          description={`${repair.summary} This proposal has not been executed or verified.`}
          className="mt-4"
        >
          <div className="mb-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
            <Badge variant="outline">{repair.provider} / {repair.model}</Badge>
            <Badge variant="outline">Unverified</Badge>
            <span>Based on job {repair.basedOnJobId}</span>
          </div>
          <div className="space-y-3">
            {repair.files.map((file) => (
              <details key={file.path} className="rounded-lg border border-border p-3">
                <summary className="cursor-pointer font-mono text-sm">{file.path}</summary>
                <pre className="mt-3 max-h-80 overflow-auto rounded bg-muted p-3 text-xs">{file.content}</pre>
                <Button className="mt-3" size="sm" onClick={() => void applyRepairFile(file)}>Reviewed — apply to {file.path}</Button>
              </details>
            ))}
          </div>
        </Panel>
      ) : null}
    </AppShell>
  );
}
