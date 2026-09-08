import { createFileRoute } from "@tanstack/react-router";
import { ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import { AppShell, Meter, Panel, StatusPill } from "@/components/helix/app-shell";
import { threats } from "@/components/helix/data";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/security")({
  head: () => ({
    meta: [
      { title: "Security Guardian — HELIX" },
      { name: "description", content: "Continuous threat detection, dependency CVE review and hardening recommendations from Security AI." },
      { property: "og:title", content: "Security Guardian — HELIX" },
      { property: "og:description", content: "Your app, protected around the clock." },
    ],
  }),
  component: Security,
});

const checks = [
  { label: "Auth & session hardening", value: 96 },
  { label: "Data access policies", value: 91 },
  { label: "Dependency hygiene", value: 78 },
  { label: "Secrets management", value: 99 },
  { label: "Input validation", value: 88 },
];

const severityTone = {
  High: "danger",
  Medium: "queued",
  Low: "info",
} as const;

function Security() {
  return (
    <AppShell
      title="Security Guardian"
      subtitle="Protecting your applications 24/7"
      action={
        <Button onClick={() => toast.success("Full security sweep started.")}>
          Run full scan
        </Button>
      }
    >
      <div className="grid gap-5 xl:grid-cols-[380px_1fr]">
        <Panel title="Security Score" description="Weighted across 5 domains">
          <div className="flex flex-col items-center py-4">
            <div className="relative flex h-40 w-40 items-center justify-center rounded-full bg-[conic-gradient(var(--color-success)_0_92%,var(--color-muted)_92%_100%)]">
              <div className="flex h-32 w-32 flex-col items-center justify-center rounded-full bg-card">
                <span className="font-display text-4xl font-bold">92</span>
                <span className="text-xs text-muted-foreground">/ 100</span>
              </div>
            </div>
            <StatusPill tone="done">Excellent</StatusPill>
          </div>
          <ul className="mt-2 space-y-3">
            {checks.map((c) => (
              <li key={c.label}>
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">{c.label}</span>
                  <span className="tabular-nums">{c.value}%</span>
                </div>
                <div className="mt-1.5">
                  <Meter value={c.value} />
                </div>
              </li>
            ))}
          </ul>
        </Panel>

        <div className="space-y-5">
          <Panel title="Threat Summary" description="4 open findings, none critical">
            <ul className="divide-y divide-border">
              {threats.map((t) => (
                <li key={t.title} className="flex items-center gap-3 py-3">
                  <ShieldCheck className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{t.title}</p>
                    <p className="text-xs text-muted-foreground">{t.area}</p>
                  </div>
                  <StatusPill tone={severityTone[t.severity as keyof typeof severityTone]}>
                    {t.severity}
                  </StatusPill>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => toast(`Security AI queued a fix for: ${t.title}`)}
                  >
                    Fix
                  </Button>
                </li>
              ))}
            </ul>
          </Panel>

          <div className="grid gap-4 sm:grid-cols-3">
            {[
              { label: "Scans today", value: "18" },
              { label: "Blocked attempts", value: "1,204" },
              { label: "Mean fix time", value: "6 min" },
            ].map((s) => (
              <div key={s.label} className="panel p-4">
                <p className="text-xs text-muted-foreground">{s.label}</p>
                <p className="mt-1 font-display text-2xl font-bold">{s.value}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
