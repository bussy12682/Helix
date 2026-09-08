import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Plus, Sparkles, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { AppShell, Panel } from "@/components/helix/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { analyzeProject, createProject, getStoredSessionToken, type ProjectAnalysis } from "@/lib/api";

export const Route = createFileRoute("/projects/summary")({
  head: () => ({
    meta: [
      { title: "Project Summary — HELIX" },
      { name: "description", content: "Review the structured plan HELIX extracted from your brief before building starts." },
      { property: "og:title", content: "Project Summary — HELIX" },
      { property: "og:description", content: "Confirm requirements, features and stack." },
    ],
  }),
  component: Summary,
});

function readAnalysis() {
  if (typeof window === "undefined") return null;

  try {
    const raw = window.sessionStorage.getItem('helix_project_analysis');
    return raw ? JSON.parse(raw) as ProjectAnalysis : null;
  } catch {
    return null;
  }
}

function Summary() {
  const navigate = useNavigate();
  const [analysis, setAnalysis] = useState<ProjectAnalysis | null>(readAnalysis);
  const [isConfirming, setIsConfirming] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState(false);

  function updateList(field: "keyFeatures" | "techStack", index: number, value: string) {
    setAnalysis((current) => {
      if (!current) return current;
      const values = [...current[field]];
      values[index] = value;
      return { ...current, [field]: values };
    });
  }

  function addListItem(field: "keyFeatures" | "techStack") {
    setAnalysis((current) => current ? { ...current, [field]: [...current[field], ""] } : current);
  }

  function removeListItem(field: "keyFeatures" | "techStack", index: number) {
    setAnalysis((current) => {
      if (!current) return current;
      return { ...current, [field]: current[field].filter((_, itemIndex) => itemIndex !== index) };
    });
  }

  async function regenerateSuggestions() {
    if (!analysis?.name.trim() || !analysis.description.trim()) {
      toast.error('Add a project name and description before regenerating suggestions.');
      return;
    }

    const token = getStoredSessionToken();
    if (!token) {
      navigate({ to: '/login' });
      return;
    }

    setIsRegenerating(true);
    try {
      const suggestions = await analyzeProject({
        name: analysis.name.trim(),
        description: analysis.description.trim(),
      }, token);
      setAnalysis((current) => current ? {
        ...current,
        keyFeatures: suggestions.keyFeatures,
        techStack: suggestions.techStack,
      } : current);
      toast.success('AI suggestions refreshed. You can edit them below.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not refresh AI suggestions.');
    } finally {
      setIsRegenerating(false);
    }
  }

  useEffect(() => {
    if (!analysis) navigate({ to: '/projects/new' });
  }, [analysis, navigate]);

  if (!analysis) return null;

  async function confirmProject() {
    const token = getStoredSessionToken();
    if (!token) {
      navigate({ to: '/login' });
      return;
    }

    setIsConfirming(true);
    try {
      await createProject({
        name: analysis.name.trim(),
        description: analysis.description.trim(),
        keyFeatures: analysis.keyFeatures.map((feature) => feature.trim()).filter(Boolean),
        techStack: analysis.techStack.map((technology) => technology.trim()).filter(Boolean),
      }, token);
      sessionStorage.removeItem('helix_project_analysis');
      toast.success('Project created. Your HELIX office is ready.');
      navigate({ to: '/office' });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not create project.');
    } finally {
      setIsConfirming(false);
    }
  }

  return (
    <AppShell title="Project Summary" subtitle="Shape the brief before HELIX starts building">
      <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        <Panel
          title="Requirements"
          description="AI suggestions are editable before confirming"
          action={(
            <Button type="button" variant="outline" size="sm" onClick={() => void regenerateSuggestions()} disabled={isRegenerating}>
              <Sparkles className="h-4 w-4" />
              {isRegenerating ? 'Thinking...' : 'Regenerate AI suggestions'}
            </Button>
          )}
        >
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="pname">Project name</Label>
              <Input
                id="pname"
                value={analysis.name}
                onChange={(event) => setAnalysis({ ...analysis, name: event.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pdesc">Description</Label>
              <Textarea
                id="pdesc"
                rows={5}
                value={analysis.description}
                onChange={(event) => setAnalysis({ ...analysis, description: event.target.value })}
              />
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-medium">AI-suggested key features</p>
                <Button type="button" variant="ghost" size="sm" onClick={() => addListItem("keyFeatures")}>
                  <Plus className="h-4 w-4" />
                  Add feature
                </Button>
              </div>
              <div className="space-y-2">
                {analysis.keyFeatures.map((feature, index) => (
                  <div key={`feature-${index}`} className="flex items-center gap-2">
                    <Input
                      aria-label={`Key feature ${index + 1}`}
                      value={feature}
                      onChange={(event) => updateList("keyFeatures", index, event.target.value)}
                    />
                    <Button type="button" variant="ghost" size="icon" aria-label={`Remove key feature ${index + 1}`} onClick={() => removeListItem("keyFeatures", index)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div className="mt-6 flex justify-end gap-2">
            <Button variant="ghost" asChild>
              <Link to="/projects/new">Back</Link>
            </Button>
            <Button onClick={confirmProject} disabled={isConfirming || !analysis.name.trim() || !analysis.description.trim()}>
              {isConfirming ? 'Creating project...' : 'Confirm & Continue'}
            </Button>
          </div>
        </Panel>

        <Panel title="AI-suggested tech stack" description="Edit the technologies HELIX should use">
          <div className="space-y-2">
            {analysis.techStack.map((technology, index) => (
              <div key={`technology-${index}`} className="flex items-center gap-2">
                <Input
                  aria-label={`Technology ${index + 1}`}
                  value={technology}
                  onChange={(event) => updateList("techStack", index, event.target.value)}
                />
                <Button type="button" variant="ghost" size="icon" aria-label={`Remove technology ${index + 1}`} onClick={() => removeListItem("techStack", index)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
            <Button type="button" variant="outline" size="sm" onClick={() => addListItem("techStack")}>
              <Plus className="h-4 w-4" />
              Add technology
            </Button>
          </div>
        </Panel>
      </div>
    </AppShell>
  );
}
