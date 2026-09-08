import { createFileRoute, Link } from "@tanstack/react-router";
import { Maximize2 } from "lucide-react";

import { AppShell, Meter, Panel, StatusPill } from "@/components/helix/app-shell";
import { agents, statusLabel } from "@/components/helix/data";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/office/")({
  head: () => ({
    meta: [
      { title: "AI Engineering Office — HELIX" },
      { name: "description", content: "Watch your Project Manager AI coordinate architecture, backend, frontend, QA, security and DevOps agents." },
      { property: "og:title", content: "AI Engineering Office — HELIX" },
      { property: "og:description", content: "Your nine-agent engineering team, live." },
    ],
  }),
  component: Office,
});

const schedule = [
  { time: "10:20", title: "Architecture review", detail: "Architecture AI · Project Manager AI" },
  { time: "10:45", title: "Schema sign-off", detail: "Database AI" },
  { time: "11:15", title: "API contract sync", detail: "Backend AI · Frontend AI" },
  { time: "12:00", title: "Security sweep", detail: "Security AI" },
  { time: "13:30", title: "Planning standup", detail: "All agents" },
];

function Office() {
  return (
    <AppShell
      title="AI Engineering Office"
      subtitle="Your team is building the E-commerce Platform"
      action={
        <Button asChild variant="outline">
          <Link to="/office/tasks">
            <Maximize2 className="mr-1.5 h-4 w-4" /> Task flow
          </Link>
        </Button>
      }
    >
      <div className="grid gap-5 xl:grid-cols-[1.6fr_1fr]">
        <Panel title="Live floor" description="Project Manager AI is orchestrating 8 agents">
          <div className="rounded-xl border border-border bg-muted/40 p-4">
            <div className="flex items-center gap-3">
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
                PM
              </span>
              <div>
                <p className="text-sm font-semibold">Project Manager AI</p>
                <p className="text-xs text-muted-foreground">Planning &amp; orchestration</p>
              </div>
              <StatusPill tone="working">Assigning work</StatusPill>
            </div>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {agents.slice(1).map((a) => (
              <div key={a.id} className="rounded-xl border border-border p-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-accent text-[11px] font-semibold text-accent-foreground">
                  {a.initials}
                </span>
                <p className="mt-2.5 text-xs font-semibold">{a.name}</p>
                <p className="text-[11px] text-muted-foreground">{a.role}</p>
                <p className="mt-2 text-[11px] text-muted-foreground">{statusLabel[a.status]}</p>
                <div className="mt-2 flex items-center gap-2">
                  <Meter value={a.progress} />
                  <span className="text-[11px] tabular-nums text-muted-foreground">
                    {a.progress}%
                  </span>
                </div>
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="Office Schedule" description="Today · automated coordination">
          <ul className="space-y-3.5">
            {schedule.map((s) => (
              <li key={s.time} className="flex gap-3">
                <span className="w-12 shrink-0 text-xs font-semibold tabular-nums text-primary">
                  {s.time}
                </span>
                <div>
                  <p className="text-sm font-medium">{s.title}</p>
                  <p className="text-xs text-muted-foreground">{s.detail}</p>
                </div>
              </li>
            ))}
          </ul>
          <Button asChild variant="outline" className="mt-5 w-full">
            <Link to="/office/tasks">View full activity</Link>
          </Button>
        </Panel>
      </div>
    </AppShell>
  );
}
