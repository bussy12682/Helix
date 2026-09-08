import { createFileRoute } from "@tanstack/react-router";
import { ExternalLink } from "lucide-react";

import { AppShell, Panel, StatusPill } from "@/components/helix/app-shell";
import { deployments } from "@/components/helix/data";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const Route = createFileRoute("/deployments")({
  head: () => ({
    meta: [
      { title: "Deployment Overview — HELIX" },
      { name: "description", content: "Production, staging and development environments deployed and monitored by DevOps AI." },
      { property: "og:title", content: "Deployment Overview — HELIX" },
      { property: "og:description", content: "Every environment, build and release in one view." },
    ],
  }),
  component: Deployments,
});

const recent = [
  { build: "#1292", env: "Development", time: "May 16, 21:33 UTC", status: "Building" },
  { build: "#1291", env: "Staging", time: "May 16, 21:10 UTC", status: "Success" },
  { build: "#1290", env: "Staging", time: "May 16, 20:52 UTC", status: "Success" },
  { build: "#1284", env: "Production", time: "May 16, 20:41 UTC", status: "Success" },
  { build: "#1283", env: "Production", time: "May 15, 18:02 UTC", status: "Rolled back" },
];

function Deployments() {
  return (
    <AppShell title="Deployment Overview" subtitle="Managed continuously by DevOps AI">
      <div className="grid gap-4 lg:grid-cols-3">
        {deployments.map((d) => (
          <Panel key={d.env} title={d.env} description={d.url}>
            <StatusPill tone={d.status === "Live" ? "live" : "working"}>{d.status}</StatusPill>
            <dl className="mt-4 space-y-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Build</dt>
                <dd className="font-medium">{d.build}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Deployed</dt>
                <dd className="font-medium">{d.time}</dd>
              </div>
            </dl>
            <Button variant="outline" size="sm" className="mt-4 w-full" asChild>
              <a href={`https://${d.url}`} target="_blank" rel="noreferrer">
                Visit <ExternalLink className="ml-1.5 h-3.5 w-3.5" />
              </a>
            </Button>
          </Panel>
        ))}
      </div>

      <Panel className="mt-5" title="Recent Deployments" description="Last 5 builds">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Build</TableHead>
              <TableHead>Environment</TableHead>
              <TableHead>Time</TableHead>
              <TableHead className="w-36">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {recent.map((r) => (
              <TableRow key={r.build}>
                <TableCell className="font-medium">{r.build}</TableCell>
                <TableCell className="text-muted-foreground">{r.env}</TableCell>
                <TableCell className="text-muted-foreground">{r.time}</TableCell>
                <TableCell>
                  <StatusPill
                    tone={
                      r.status === "Success"
                        ? "done"
                        : r.status === "Building"
                          ? "working"
                          : "danger"
                    }
                  >
                    {r.status}
                  </StatusPill>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Panel>
    </AppShell>
  );
}
