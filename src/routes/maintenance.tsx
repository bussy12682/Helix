import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";

import { AppShell, Meter, Panel, StatusPill } from "@/components/helix/app-shell";
import { maintenanceUpdates } from "@/components/helix/data";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";

export const Route = createFileRoute("/maintenance")({
  head: () => ({
    meta: [
      { title: "Maintenance Engine — HELIX" },
      { name: "description", content: "Dependency upkeep, uptime monitoring and self-healing fixes handled by your maintenance agents." },
      { property: "og:title", content: "Maintenance Engine — HELIX" },
      { property: "og:description", content: "Keep every project current and healthy." },
    ],
  }),
  component: Maintenance,
});

const health = [
  { label: "Uptime (30d)", value: "99.98%" },
  { label: "Avg response", value: "184 ms" },
  { label: "Error rate", value: "0.04%" },
  { label: "Open incidents", value: "0" },
];

const jobs = [
  { title: "Nightly dependency scan", detail: "Runs 02:00 UTC daily", on: true },
  { title: "Auto-apply patch updates", detail: "Patch-level only, with tests", on: true },
  { title: "Auto-heal failing jobs", detail: "Retry, then open a fix task", on: false },
  { title: "Weekly performance report", detail: "Emailed every Monday", on: true },
];

function Maintenance() {
  return (
    <AppShell title="Maintenance Engine" subtitle="Keeping your projects updated, secure and healthy">
      <div className="grid gap-5 xl:grid-cols-[1.5fr_1fr]">
        <div className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {health.map((h) => (
              <div key={h.label} className="panel p-4">
                <p className="text-xs text-muted-foreground">{h.label}</p>
                <p className="mt-1 font-display text-2xl font-bold">{h.value}</p>
              </div>
            ))}
          </div>

          <Panel
            title="Available Updates"
            description="4 dependencies behind latest"
            action={
              <Button size="sm" onClick={() => toast.success("Applying 3 safe updates…")}>
                Apply all safe
              </Button>
            }
          >
            <ul className="divide-y divide-border">
              {maintenanceUpdates.map((u) => (
                <li key={u.name} className="flex items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{u.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {u.from} → {u.to}
                    </p>
                  </div>
                  <Badge variant={u.kind === "Major" ? "destructive" : "secondary"}>
                    {u.kind}
                  </Badge>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => toast(`Queued update for ${u.name}.`)}
                  >
                    Update
                  </Button>
                </li>
              ))}
            </ul>
          </Panel>

          <Panel title="Self-healing activity" description="Last 24 hours">
            <ul className="space-y-3">
              {[
                { t: "Restarted stalled image worker", s: "resolved" },
                { t: "Patched flaky checkout test", s: "resolved" },
                { t: "Investigating slow vendor query", s: "working" },
              ].map((r) => (
                <li key={r.t} className="flex items-center justify-between gap-3">
                  <span className="text-sm">{r.t}</span>
                  <StatusPill tone={r.s === "resolved" ? "done" : "working"}>
                    {r.s === "resolved" ? "Resolved" : "In progress"}
                  </StatusPill>
                </li>
              ))}
            </ul>
          </Panel>
        </div>

        <div className="space-y-5">
          <Panel title="Automation" description="What the engine handles for you">
            <ul className="space-y-4">
              {jobs.map((j) => (
                <li key={j.title} className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium">{j.title}</p>
                    <p className="text-xs text-muted-foreground">{j.detail}</p>
                  </div>
                  <Switch defaultChecked={j.on} aria-label={j.title} />
                </li>
              ))}
            </ul>
          </Panel>

          <Panel title="Test suite" description="Maintained by QA AI">
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Coverage</span>
                <span>87%</span>
              </div>
              <Meter value={87} />
            </div>
            <p className="mt-4 text-xs text-muted-foreground">
              412 tests · 0 failing · last run 12 minutes ago
            </p>
          </Panel>
        </div>
      </div>
    </AppShell>
  );
}
