import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";

import { AppShell, Panel } from "@/components/helix/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "Project Settings — HELIX" },
      { name: "description", content: "Configure project details, agent behaviour, environments and notifications." },
      { property: "og:title", content: "Project Settings — HELIX" },
      { property: "og:description", content: "General, agents, environment and notification settings." },
    ],
  }),
  component: Settings,
});

function Settings() {
  return (
    <AppShell
      title="Project Settings"
      subtitle="E-commerce Platform"
      action={
        <Button onClick={() => toast.success("Settings saved.")}>Save changes</Button>
      }
    >
      <Tabs defaultValue="general">
        <TabsList>
          <TabsTrigger value="general">General</TabsTrigger>
          <TabsTrigger value="agents">AI Agents</TabsTrigger>
          <TabsTrigger value="environment">Environment</TabsTrigger>
          <TabsTrigger value="notifications">Notifications</TabsTrigger>
        </TabsList>

        <TabsContent value="general" className="mt-5">
          <Panel title="General" description="Basic project information">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="name">Project name</Label>
                <Input id="name" defaultValue="E-commerce Platform" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="tz">Timezone</Label>
                <Select defaultValue="utc">
                  <SelectTrigger id="tz">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="utc">UTC</SelectItem>
                    <SelectItem value="wat">West Africa Time</SelectItem>
                    <SelectItem value="cet">Central European Time</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5 md:col-span-2">
                <Label htmlFor="desc">Description</Label>
                <Textarea
                  id="desc"
                  rows={3}
                  defaultValue="Multi-vendor marketplace with Stripe payouts and vendor dashboards."
                />
              </div>
            </div>
          </Panel>
        </TabsContent>

        <TabsContent value="agents" className="mt-5">
          <Panel title="Agent behaviour" description="How much autonomy your team has">
            <ul className="space-y-4">
              {[
                ["Auto-assign new tasks", true],
                ["Let agents refactor without approval", false],
                ["Require security review before deploy", true],
                ["Allow agents to add dependencies", true],
              ].map(([label, on]) => (
                <li key={label as string} className="flex items-center justify-between gap-3">
                  <span className="text-sm">{label}</span>
                  <Switch defaultChecked={on as boolean} aria-label={label as string} />
                </li>
              ))}
            </ul>
          </Panel>
        </TabsContent>

        <TabsContent value="environment" className="mt-5">
          <Panel title="Environment variables" description="Encrypted at rest">
            <div className="space-y-3">
              {["DATABASE_URL", "STRIPE_SECRET_KEY", "RESEND_API_KEY"].map((k) => (
                <div key={k} className="grid gap-2 sm:grid-cols-[240px_1fr]">
                  <Input defaultValue={k} aria-label="Variable name" />
                  <Input type="password" defaultValue="••••••••••••" aria-label="Value" />
                </div>
              ))}
            </div>
            <Button variant="outline" className="mt-4" onClick={() => toast("Added a blank variable row (demo).")}>
              Add variable
            </Button>
          </Panel>
        </TabsContent>

        <TabsContent value="notifications" className="mt-5">
          <Panel title="Notifications" description="Where HELIX reaches you">
            <ul className="space-y-4">
              {[
                ["Deployment results", true],
                ["Security findings", true],
                ["Agent questions", true],
                ["Weekly digest", false],
              ].map(([label, on]) => (
                <li key={label as string} className="flex items-center justify-between gap-3">
                  <span className="text-sm">{label}</span>
                  <Switch defaultChecked={on as boolean} aria-label={label as string} />
                </li>
              ))}
            </ul>
          </Panel>
        </TabsContent>
      </Tabs>
    </AppShell>
  );
}
