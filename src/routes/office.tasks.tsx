import { createFileRoute, Link } from "@tanstack/react-router";

import { AppShell, Meter, Panel, StatusPill } from "@/components/helix/app-shell";
import { tasks } from "@/components/helix/data";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const Route = createFileRoute("/office/tasks")({
  head: () => ({
    meta: [
      { title: "Task Assignment Flow — HELIX" },
      { name: "description", content: "See how the Project Manager AI assigns and tracks every task across your agents." },
      { property: "og:title", content: "Task Assignment Flow — HELIX" },
      { property: "og:description", content: "Live task log across all nine agents." },
    ],
  }),
  component: TaskFlow,
});

const log = [
  { agent: "Architecture AI", entry: "Assigned: service topology" },
  { agent: "Database AI", entry: "Assigned: order schema" },
  { agent: "Backend AI", entry: "Waiting on schema sign-off" },
  { agent: "Frontend AI", entry: "Assigned: product listing" },
  { agent: "Security AI", entry: "Queued after first build" },
  { agent: "QA AI", entry: "Queued: E2E specs" },
];

function TaskFlow() {
  return (
    <AppShell
      title="Task Assignment Flow"
      subtitle="Project Manager AI · E-commerce Platform"
      action={
        <Button asChild variant="outline">
          <Link to="/office">Back to office</Link>
        </Button>
      }
    >
      <div className="grid gap-5 xl:grid-cols-[1fr_320px]">
        <Panel title="Task Log" description="Every assignment, ordered by priority">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Agent</TableHead>
                <TableHead>Task</TableHead>
                <TableHead className="w-40">Progress</TableHead>
                <TableHead className="w-36">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tasks.map((t) => (
                <TableRow key={t.task}>
                  <TableCell className="text-sm font-medium">{t.agent}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{t.task}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Meter value={t.progress} />
                      <span className="text-xs tabular-nums text-muted-foreground">
                        {t.progress}%
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <StatusPill tone={t.status as "done" | "working" | "queued"}>
                      {t.status === "done"
                        ? "Completed"
                        : t.status === "working"
                          ? "Working"
                          : "Queued"}
                    </StatusPill>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Panel>

        <Panel title="Assignment stream" description="Newest first">
          <ul className="space-y-3">
            {log.map((l) => (
              <li key={l.entry} className="rounded-lg border border-border p-3">
                <p className="text-xs font-semibold">{l.agent}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{l.entry}</p>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    </AppShell>
  );
}
