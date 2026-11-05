import type { ReactNode } from "react";

import { StatusPill } from "@/components/helix/app-shell";
import type { OfficeTask } from "@/lib/api";

export const taskStatusLabel: Record<OfficeTask["status"], string> = {
  queued: "Queued",
  running: "Working",
  completed: "Done",
  awaiting_approval: "Approval",
  needs_revision: "Revising",
  failed: "Failed",
  cancelled: "Cancelled",
};

export function taskTone(status: string) {
  if (status === "completed" || status === "done") return "done" as const;
  if (status === "running" || status === "working" || status === "needs_revision")
    return "working" as const;
  if (status === "awaiting_approval") return "queued" as const;
  if (status === "failed") return "danger" as const;
  return "idle" as const;
}

export function workflowTone(status: string) {
  if (status === "completed") return "done" as const;
  if (status === "running" || status === "pending") return "working" as const;
  if (status === "awaiting_approval") return "queued" as const;
  if (status === "failed" || status === "cancelled") return "danger" as const;
  return "idle" as const;
}

export function ProviderBadge({
  provider,
  model,
  simulated,
}: {
  provider?: string | null | undefined;
  model?: string | null | undefined;
  simulated?: boolean | undefined;
}) {
  if (!provider) return null;
  if (simulated) {
    return (
      <span
        className="inline-flex items-center rounded bg-warning/15 px-1.5 py-0.5 text-[10px] font-semibold text-warning-foreground"
        title="Output produced by the deterministic offline generator, not a real AI model"
      >
        Simulated output
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
      title={`${provider} · ${model ?? ""}`}
    >
      {provider}
      {model ? ` · ${model}` : ""}
    </span>
  );
}

export function SeverityPill({ severity }: { severity: string }): ReactNode {
  const tone =
    severity === "critical" || severity === "high"
      ? "danger"
      : severity === "medium"
        ? "queued"
        : "info";
  return <StatusPill tone={tone}>{severity}</StatusPill>;
}
