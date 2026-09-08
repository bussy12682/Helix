import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Plus, Rocket } from "lucide-react";
import { useEffect, useState } from "react";

import { AppShell, Meter, Panel, StatusPill } from "@/components/helix/app-shell";
import { Button } from "@/components/ui/button";
import { getDashboard, getStoredSessionToken } from "@/lib/api";

export const Route = createFileRoute("/dashboard")({
  head: () => ({
    meta: [
      { title: "Dashboard — HELIX" },
      { name: "description", content: "Track projects and deployments across your HELIX engineering office." },
      { property: "og:title", content: "Dashboard — HELIX" },
      { property: "og:description", content: "Your projects and deployments at a glance." },
    ],
  }),
  component: Dashboard,
});

type DashboardData = Awaited<ReturnType<typeof getDashboard>>;

function Dashboard() {
  const navigate = useNavigate();
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const token = getStoredSessionToken();
    if (!token) {
      navigate({ to: '/login' });
      return;
    }

    getDashboard(token)
      .then(setDashboard)
      .catch((requestError) => {
        if (requestError instanceof Error && 'code' in requestError && requestError.code === 'SESSION_EXPIRED') {
          navigate({ to: '/login' });
          return;
        }
        setError('We could not load your workspace right now.');
      });
  }, [navigate]);

  if (error) {
    return (
      <AppShell title="Dashboard" subtitle="Your workspace overview">
        <Panel title="Dashboard unavailable" description={error}>
          <Button onClick={() => window.location.reload()}>Try again</Button>
        </Panel>
      </AppShell>
    );
  }

  if (!dashboard) {
    return (
      <AppShell title="Dashboard" subtitle="Loading your workspace">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }, (_, index) => <div key={index} className="panel h-28 animate-pulse bg-muted/40" />)}
        </div>
      </AppShell>
    );
  }

  const { projects, stats, user } = dashboard;
  const recentProjects = [...projects].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 5);
  const statCards = [
    { label: 'Projects', value: stats.projects, note: 'In workspace' },
    { label: 'Active', value: stats.activeProjects, note: 'Being built' },
    { label: 'Completed', value: stats.completedProjects, note: 'Finished' },
    { label: 'Deployments', value: stats.deployments, note: 'Live releases' },
  ];

  return (
    <AppShell
      title="Dashboard"
      subtitle={`Welcome back, ${user.name}. Here is your workspace at a glance.`}
      action={
        <Button asChild>
          <Link to="/projects/new">
            <Plus className="mr-1.5 h-4 w-4" /> New Project
          </Link>
        </Button>
      }
    >
      <div className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {statCards.map((stat) => (
            <div key={stat.label} className="panel p-4">
              <p className="text-xs text-muted-foreground">{stat.label}</p>
              <p className="mt-1 font-display text-3xl font-bold">{stat.value}</p>
              <p className="mt-1 text-xs text-primary">{stat.note}</p>
            </div>
          ))}
        </div>

        <Panel
          title="Your projects"
          description={projects.length ? 'The latest work in your engineering workspace.' : 'Create your first project to start building.'}
          action={<Button asChild variant="ghost" size="sm"><Link to="/projects">View all</Link></Button>}
        >
          {recentProjects.length ? (
            <ul className="divide-y divide-border">
              {recentProjects.map((project) => {
                const progress = Math.max(0, Math.min(100, project.progress));
                const completed = project.status === 'completed';
                return (
                  <li key={project.id} className="flex items-center gap-4 py-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent text-xs font-semibold text-accent-foreground">{project.name.slice(0, 2).toUpperCase()}</div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{project.name}</p>
                      <p className="truncate text-xs text-muted-foreground">{project.description || 'Project workspace'}</p>
                    </div>
                    <div className="hidden w-28 sm:block"><Meter value={progress} /></div>
                    <StatusPill tone={completed ? 'done' : 'working'}>{completed ? 'Completed' : 'Active'}</StatusPill>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="rounded-lg border border-dashed border-border p-8 text-center">
              <Rocket className="mx-auto h-8 w-8 text-muted-foreground" />
              <p className="mt-3 text-sm font-medium">No projects yet</p>
              <p className="mt-1 text-xs text-muted-foreground">Start with a brief and your first workspace will appear here.</p>
              <Button asChild className="mt-4"><Link to="/projects/new">Create a project</Link></Button>
            </div>
          )}
        </Panel>

        <Panel title="Account" description="The signed-in identity for this workspace.">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div><p className="text-sm font-medium">{user.name}</p><p className="text-xs text-muted-foreground">{user.email}</p></div>
            <span className="text-xs text-success">Authenticated</span>
          </div>
        </Panel>
      </div>
    </AppShell>
  );
}
