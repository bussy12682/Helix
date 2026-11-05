import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { getStoredSessionToken, listProjects } from "@/lib/api";

const ACTIVE_PROJECT_KEY = "helix_active_project_id";

type ProjectSummary = Awaited<ReturnType<typeof listProjects>>[number];

/**
 * Resolves the active project (persisted in sessionStorage) for the signed-in user,
 * falling back to the most recent project. Redirects to /login without a session.
 */
export function useActiveProject() {
  const navigate = useNavigate();
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [projectId, setProjectIdState] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const token = getStoredSessionToken();
    if (!token) {
      void navigate({ to: "/login" });
      return;
    }
    let cancelled = false;
    listProjects(token)
      .then((list) => {
        if (cancelled) return;
        setProjects(list);
        const stored = window.sessionStorage.getItem(ACTIVE_PROJECT_KEY);
        const chosen = list.find((p) => p.id === stored)?.id ?? list[0]?.id ?? null;
        if (chosen) window.sessionStorage.setItem(ACTIVE_PROJECT_KEY, chosen);
        setProjectIdState(chosen);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load projects");
        if (
          err?.code === "SESSION_EXPIRED" ||
          err?.code === "UNAUTHORIZED" ||
          err?.code === "INVALID_SESSION"
        ) {
          void navigate({ to: "/login" });
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  function setProjectId(id: string) {
    window.sessionStorage.setItem(ACTIVE_PROJECT_KEY, id);
    setProjectIdState(id);
  }

  const project = projects.find((p) => p.id === projectId) ?? null;
  return { projects, project, projectId, setProjectId, isLoading, error };
}
