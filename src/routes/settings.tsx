import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { AppShell, Panel, StatusPill } from "@/components/helix/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  ApiRequestError,
  changePassword,
  getCurrentUser,
  getProject,
  getStoredSessionToken,
  getSystemHealth,
  updateCurrentUser,
  updateProject,
  type CurrentUser,
  type SystemHealth,
} from "@/lib/api";
import { useActiveProject } from "@/lib/use-active-project";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "Settings — HELIX" },
      {
        name: "description",
        content: "Edit project details, your account and inspect the AI runtime configuration.",
      },
      { property: "og:title", content: "Settings — HELIX" },
      { property: "og:description", content: "Project, account and system settings." },
    ],
  }),
  component: Settings,
});

const toList = (value: string) =>
  value
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
const errorText = (err: unknown) =>
  err instanceof ApiRequestError && err.details?.length
    ? `${err.message}: ${err.details.join(", ")}`
    : err instanceof Error
      ? err.message
      : "Request failed";

function Settings() {
  const { projects, projectId, setProjectId } = useActiveProject();
  const [form, setForm] = useState({ name: "", description: "", keyFeatures: "", techStack: "" });
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [passwords, setPasswords] = useState({ current: "", next: "" });
  const [health, setHealth] = useState<SystemHealth | null>(null);
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    const token = getStoredSessionToken();
    if (!token || !projectId) return;
    getProject(projectId, token)
      .then((p) =>
        setForm({
          name: p.name,
          description: p.description ?? "",
          keyFeatures: (p.keyFeatures ?? []).join(", "),
          techStack: (p.techStack ?? []).join(", "),
        }),
      )
      .catch((err) => toast.error(errorText(err)));
  }, [projectId]);

  useEffect(() => {
    const token = getStoredSessionToken();
    if (token) {
      getCurrentUser(token)
        .then((res) => {
          setUser(res.user);
          setDisplayName(res.user.name);
        })
        .catch(() => null);
    }
    getSystemHealth()
      .then(setHealth)
      .catch(() => setHealth(null));
  }, []);

  async function run(key: string, fn: (token: string) => Promise<void>) {
    const token = getStoredSessionToken();
    if (!token) return;
    setSaving(key);
    try {
      await fn(token);
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setSaving(null);
    }
  }

  const saveProject = () =>
    run("project", async (token) => {
      if (!projectId) return;
      await updateProject(
        projectId,
        {
          name: form.name,
          description: form.description,
          keyFeatures: toList(form.keyFeatures),
          techStack: toList(form.techStack),
        },
        token,
      );
      toast.success("Project saved. Agents that run from now on use the updated brief.");
    });

  const saveProfile = () =>
    run("profile", async (token) => {
      const res = await updateCurrentUser({ name: displayName }, token);
      setUser(res.user);
      toast.success("Profile updated.");
    });

  const savePassword = () =>
    run("password", async (token) => {
      await changePassword(passwords.current, passwords.next, token);
      setPasswords({ current: "", next: "" });
      toast.success("Password changed. Other sessions were signed out.");
    });

  return (
    <AppShell title="Settings" subtitle="Project, account and system configuration">
      <Tabs defaultValue="project">
        <TabsList>
          <TabsTrigger value="project">Project</TabsTrigger>
          <TabsTrigger value="account">Account</TabsTrigger>
          <TabsTrigger value="system">System</TabsTrigger>
        </TabsList>

        <TabsContent value="project" className="mt-5">
          <Panel
            title="Project brief"
            description="Agents read this brief as their source of truth"
          >
            {projects.length === 0 ? (
              <p className="text-sm text-muted-foreground">You have no projects yet.</p>
            ) : (
              <div className="grid gap-4 md:grid-cols-2">
                {projects.length > 1 && (
                  <div className="space-y-1.5 md:col-span-2">
                    <Label htmlFor="project-select">Project</Label>
                    <select
                      id="project-select"
                      className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                      value={projectId ?? ""}
                      onChange={(e) => setProjectId(e.target.value)}
                    >
                      {projects.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                <div className="space-y-1.5 md:col-span-2">
                  <Label htmlFor="name">Project name</Label>
                  <Input
                    id="name"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5 md:col-span-2">
                  <Label htmlFor="desc">Description</Label>
                  <Textarea
                    id="desc"
                    rows={4}
                    value={form.description}
                    onChange={(e) => setForm({ ...form, description: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="features">Key features (comma separated)</Label>
                  <Input
                    id="features"
                    value={form.keyFeatures}
                    onChange={(e) => setForm({ ...form, keyFeatures: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="stack">Tech stack (comma separated)</Label>
                  <Input
                    id="stack"
                    value={form.techStack}
                    onChange={(e) => setForm({ ...form, techStack: e.target.value })}
                  />
                </div>
                <div className="md:col-span-2">
                  <Button
                    onClick={() => void saveProject()}
                    disabled={saving === "project" || !form.name.trim()}
                  >
                    {saving === "project" ? "Saving…" : "Save project"}
                  </Button>
                </div>
              </div>
            )}
          </Panel>
        </TabsContent>

        <TabsContent value="account" className="mt-5 space-y-5">
          <Panel
            title="Profile"
            description={user ? `${user.email} · signed in with ${user.authProvider}` : "Loading…"}
          >
            <div className="flex max-w-md items-end gap-3">
              <div className="flex-1 space-y-1.5">
                <Label htmlFor="display-name">Display name</Label>
                <Input
                  id="display-name"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                />
              </div>
              <Button
                onClick={() => void saveProfile()}
                disabled={saving === "profile" || !displayName.trim()}
              >
                Save
              </Button>
            </div>
          </Panel>
          {user?.authProvider === "password" && (
            <Panel title="Change password" description="Signs out every other session">
              <div className="grid max-w-md gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="current-password">Current password</Label>
                  <Input
                    id="current-password"
                    type="password"
                    autoComplete="current-password"
                    value={passwords.current}
                    onChange={(e) => setPasswords({ ...passwords, current: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="new-password">New password</Label>
                  <Input
                    id="new-password"
                    type="password"
                    autoComplete="new-password"
                    value={passwords.next}
                    onChange={(e) => setPasswords({ ...passwords, next: e.target.value })}
                  />
                </div>
                <div>
                  <Button
                    onClick={() => void savePassword()}
                    disabled={saving === "password" || !passwords.current || !passwords.next}
                  >
                    Update password
                  </Button>
                </div>
              </div>
            </Panel>
          )}
        </TabsContent>

        <TabsContent value="system" className="mt-5">
          <Panel
            title="Runtime"
            description="Live configuration reported by the HELIX backend (read-only; set via environment variables)"
          >
            {!health ? (
              <p className="text-sm text-muted-foreground">Backend unreachable.</p>
            ) : (
              <dl className="grid gap-3 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-xs text-muted-foreground">Status</dt>
                  <dd>
                    <StatusPill tone="live">{health.status}</StatusPill>
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Environment</dt>
                  <dd>{health.environment}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Persistence</dt>
                  <dd>{health.storage}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">AI mode</dt>
                  <dd>
                    <StatusPill tone={health.ai?.mode === "live" ? "done" : "queued"}>
                      {health.ai?.mode ?? "unknown"}
                    </StatusPill>
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Primary provider</dt>
                  <dd>{health.ai?.primaryProvider}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Fallback providers</dt>
                  <dd>{health.ai?.fallbackProviders.join(", ") || "none"}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Providers with credentials</dt>
                  <dd>{health.ai?.configuredProviders.join(", ") || "none"}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">
                    Simulated fallback when unconfigured
                  </dt>
                  <dd>{health.ai?.mockFallbackAllowed ? "allowed" : "disabled"}</dd>
                </div>
              </dl>
            )}
          </Panel>
        </TabsContent>
      </Tabs>
    </AppShell>
  );
}
