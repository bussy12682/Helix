import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";

import { AppShell, Meter, Panel, StatusPill } from "@/components/helix/app-shell";
import { Button } from "@/components/ui/button";
import { deleteProject, getStoredSessionToken, listProjects } from "@/lib/api";

export const Route = createFileRoute("/projects/")({
  head: () => ({
    meta: [
      { title: "Projects — HELIX" },
      { name: "description", content: "Every product your HELIX agents are building, testing and maintaining." },
      { property: "og:title", content: "Projects — HELIX" },
      { property: "og:description", content: "All builds in one place." },
    ],
  }),
  component: Projects,
});

function Projects() {
  const navigate = useNavigate();
  const [projectRows, setProjectRows] = useState<Awaited<ReturnType<typeof listProjects>>>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [deletingProjectId, setDeletingProjectId] = useState<string | null>(null);

  useEffect(() => {
    const token = getStoredSessionToken();
    if (!token) {
      navigate({ to: '/login' });
      return;
    }

    listProjects(token)
      .then(setProjectRows)
      .catch((requestError) => {
        if (requestError instanceof Error && 'code' in requestError && requestError.code === 'SESSION_EXPIRED') {
          navigate({ to: '/login' });
          return;
        }
        setError('We could not load your projects right now.');
      })
      .finally(() => setIsLoading(false));
  }, [navigate]);

  async function handleDelete(projectId: string, projectName: string) {
    if (!window.confirm(`Delete "${projectName}"? This cannot be undone.`)) return;

    const token = getStoredSessionToken();
    if (!token) {
      navigate({ to: '/login' });
      return;
    }

    setDeletingProjectId(projectId);
    try {
      await deleteProject(projectId, token);
      setProjectRows((projects) => projects.filter((project) => project.id !== projectId));
    } catch (requestError) {
      if (requestError instanceof Error && 'code' in requestError && requestError.code === 'SESSION_EXPIRED') {
        navigate({ to: '/login' });
        return;
      }
      setError('We could not delete that project right now.');
    } finally {
      setDeletingProjectId(null);
    }
  }

  return (
    <AppShell
      title="Projects"
      subtitle={`${projectRows.length} project${projectRows.length === 1 ? '' : 's'} in your workspace`}
      action={
        <Button asChild>
          <Link to="/projects/new">
            <Plus className="mr-1.5 h-4 w-4" /> New Project
          </Link>
        </Button>
      }
    >
      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }, (_, index) => <div key={index} className="panel h-48 animate-pulse bg-muted/40" />)}
        </div>
      ) : error ? (
        <Panel title="Projects unavailable" description={error}>
          <Button onClick={() => window.location.reload()}>Try again</Button>
        </Panel>
      ) : projectRows.length === 0 ? (
        <Panel title="No projects yet" description="Create a project brief and it will appear here.">
          <Button asChild><Link to="/projects/new">Create your first project</Link></Button>
        </Panel>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {projectRows.map((project) => {
            const completed = project.status === 'completed';
            return (
              <Panel key={project.id} title={project.name} description={project.description || 'Project workspace'}>
                <StatusPill tone={completed ? 'done' : 'working'}>{completed ? 'Completed' : 'Active'}</StatusPill>
                <div className="mt-4 space-y-1.5">
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>Build progress</span><span>{project.progress}%</span>
                  </div>
                  <Meter value={project.progress} />
                </div>
                <div className="mt-4 flex gap-2">
                  <Button asChild size="sm" variant="ghost"><Link to="/office">Office</Link></Button>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    title={`Delete ${project.name}`}
                    aria-label={`Delete ${project.name}`}
                    disabled={deletingProjectId === project.id}
                    onClick={() => handleDelete(project.id, project.name)}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </Panel>
            );
          })}
        </div>
      )}
    </AppShell>
  );
}
