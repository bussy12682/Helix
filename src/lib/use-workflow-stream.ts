import { useCallback, useEffect, useRef, useState } from "react";

import {
  getProjectArtifacts,
  getProjectOffice,
  getStoredSessionToken,
  subscribeToProjectEvents,
  type Artifact,
  type OfficeFloorState,
  type WorkflowEvent,
} from "@/lib/api";

const LIVE_OUTPUT_LIMIT = 2000;
const FALLBACK_POLL_MS = 10000;

/**
 * Live view of a project's workflow: initial fetch + SSE push updates (with polling fallback when
 * the stream is down). Also accumulates the tail of each agent's streamed model output.
 */
export function useWorkflowStream(
  projectId: string | null,
  options: { withArtifacts?: boolean } = {},
) {
  const { withArtifacts = false } = options;
  const [floorState, setFloorState] = useState<OfficeFloorState | null>(null);
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [liveOutput, setLiveOutput] = useState<Record<string, string>>({});
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(async () => {
    const token = getStoredSessionToken();
    if (!token || !projectId) return;
    try {
      const [office, arts] = await Promise.all([
        getProjectOffice(projectId, token),
        withArtifacts ? getProjectArtifacts(projectId, token) : Promise.resolve(null),
      ]);
      setFloorState(office);
      if (arts) setArtifacts(arts.artifacts ?? []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load workflow state");
    }
  }, [projectId, withArtifacts]);

  // Coalesce bursts of events into one refetch.
  const scheduleRefresh = useCallback(() => {
    if (refreshTimer.current) return;
    refreshTimer.current = setTimeout(() => {
      refreshTimer.current = null;
      void refresh();
    }, 300);
  }, [refresh]);

  useEffect(() => {
    const token = getStoredSessionToken();
    if (!token || !projectId) return;
    setLiveOutput({});
    void refresh();

    const unsubscribe = subscribeToProjectEvents(projectId, token, {
      onStatus: setConnected,
      onEvent: (event: WorkflowEvent) => {
        if (event.type === "office_snapshot" && event.payload) {
          setFloorState(event.payload as unknown as OfficeFloorState);
          return;
        }
        if (event.type === "task_stream" && event.payload?.taskId && event.payload.delta) {
          const { taskId, delta } = event.payload;
          setLiveOutput((prev) => ({
            ...prev,
            [taskId]: ((prev[taskId] ?? "") + delta).slice(-LIVE_OUTPUT_LIMIT),
          }));
          return;
        }
        if (event.type === "task_started" && event.payload?.taskId) {
          const { taskId } = event.payload;
          setLiveOutput((prev) => ({ ...prev, [taskId]: "" }));
        }
        if (event.type !== "connected" && event.type !== "tool_called") scheduleRefresh();
      },
    });

    return () => {
      unsubscribe();
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      refreshTimer.current = null;
    };
  }, [projectId, refresh, scheduleRefresh]);

  useEffect(() => {
    if (connected || !projectId) return;
    const interval = setInterval(() => void refresh(), FALLBACK_POLL_MS);
    return () => clearInterval(interval);
  }, [connected, projectId, refresh]);

  return { floorState, artifacts, liveOutput, connected, error, refresh };
}
