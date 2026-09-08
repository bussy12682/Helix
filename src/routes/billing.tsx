import { createFileRoute } from "@tanstack/react-router";
import { Check } from "lucide-react";
import { toast } from "sonner";

import { AppShell, Meter, Panel } from "@/components/helix/app-shell";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const Route = createFileRoute("/billing")({
  head: () => ({
    meta: [
      { title: "Billing & Plan — HELIX" },
      { name: "description", content: "Manage your HELIX subscription, usage and invoices." },
      { property: "og:title", content: "Billing & Plan — HELIX" },
      { property: "og:description", content: "Plan, usage and invoice history." },
    ],
  }),
  component: Billing,
});

const included = [
  "Unlimited projects",
  "All 9 AI agents",
  "Staging & production deploys",
  "Continuous security review",
  "Priority support",
];

const usage = [
  { label: "Agent hours", used: 412, cap: 600 },
  { label: "Builds", used: 128, cap: 200 },
  { label: "Deployments", used: 36, cap: 100 },
  { label: "Storage (GB)", used: 18, cap: 50 },
];

const invoices = [
  { id: "INV-2041", date: "Jun 1, 2026", amount: "$49.00", status: "Paid" },
  { id: "INV-1988", date: "May 1, 2026", amount: "$49.00", status: "Paid" },
  { id: "INV-1934", date: "Apr 1, 2026", amount: "$49.00", status: "Paid" },
];

function Billing() {
  return (
    <AppShell title="Billing & Plan" subtitle="Manage your subscription and usage">
      <div className="grid gap-5 xl:grid-cols-[1fr_1fr]">
        <Panel title="Current Plan">
          <div className="flex items-end gap-3">
            <p className="font-display text-3xl font-bold">Pro Plan</p>
            <p className="pb-1 text-sm text-muted-foreground">
              <span className="font-display text-xl font-bold text-foreground">$49</span> /month
            </p>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">Renews July 1, 2026</p>
          <ul className="mt-5 space-y-2">
            {included.map((f) => (
              <li key={f} className="flex items-center gap-2 text-sm text-muted-foreground">
                <Check className="h-4 w-4 text-success" /> {f}
              </li>
            ))}
          </ul>
          <div className="mt-6 flex gap-2">
            <Button onClick={() => toast("Plan management is a demo action.")}>
              Manage Plan
            </Button>
            <Button variant="outline" onClick={() => toast("Payment method updated (demo).")}>
              Update payment method
            </Button>
          </div>
        </Panel>

        <Panel title="Usage This Month" description="Resets July 1">
          <ul className="space-y-4">
            {usage.map((u) => (
              <li key={u.label}>
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">{u.label}</span>
                  <span className="tabular-nums">
                    {u.used} / {u.cap}
                  </span>
                </div>
                <div className="mt-1.5">
                  <Meter value={(u.used / u.cap) * 100} />
                </div>
              </li>
            ))}
          </ul>
        </Panel>
      </div>

      <Panel className="mt-5" title="Invoices">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Invoice</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Amount</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {invoices.map((i) => (
              <TableRow key={i.id}>
                <TableCell className="font-medium">{i.id}</TableCell>
                <TableCell className="text-muted-foreground">{i.date}</TableCell>
                <TableCell>{i.amount}</TableCell>
                <TableCell className="text-success">{i.status}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Panel>
    </AppShell>
  );
}
