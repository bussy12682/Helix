import { createFileRoute } from "@tanstack/react-router";
import { Plug } from "lucide-react";
import { toast } from "sonner";

import { AppShell, Panel, StatusPill } from "@/components/helix/app-shell";
import { integrations } from "@/components/helix/data";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/integrations")({
  head: () => ({
    meta: [
      { title: "Cloud Connect & Integrations — HELIX" },
      { name: "description", content: "Connect GitHub, databases, hosting, payments and email so your agents can ship end to end." },
      { property: "og:title", content: "Cloud Connect & Integrations — HELIX" },
      { property: "og:description", content: "Wire up your stack in one click." },
    ],
  }),
  component: Integrations,
});

function Integrations() {
  const connected = integrations.filter((i) => i.connected).length;

  return (
    <AppShell
      title="Cloud Connect & Integrations"
      subtitle={`${connected} of ${integrations.length} services connected`}
    >
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {integrations.map((i) => (
          <Panel key={i.name}>
            <div className="flex items-start gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
                <Plug className="h-4 w-4 text-muted-foreground" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">{i.name}</p>
                <p className="text-xs text-muted-foreground">{i.kind}</p>
              </div>
            </div>
            <div className="mt-4 flex items-center justify-between">
              <StatusPill tone={i.connected ? "live" : "idle"}>
                {i.connected ? "Connected" : "Not connected"}
              </StatusPill>
              <Button
                size="sm"
                variant={i.connected ? "ghost" : "outline"}
                onClick={() =>
                  toast(`${i.connected ? "Disconnect" : "Connect"} ${i.name} — demo action.`)
                }
              >
                {i.connected ? "Manage" : "Connect"}
              </Button>
            </div>
          </Panel>
        ))}
      </div>
    </AppShell>
  );
}
