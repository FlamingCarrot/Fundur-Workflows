"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useStudio } from "@/components/providers/StudioProvider";
import { teamBackend, type TeamBackend, type TeamPerson } from "@/lib/team/client";

/** The team space's backend for a project, and who "me" is in it. */
export function useTeamBackend(projectId: string): { backend: TeamBackend; me: TeamPerson; server: boolean } {
  const { persistence, viewer } = useStudio();
  const server = persistence === "server";
  const me = useMemo<TeamPerson>(() => ({ id: viewer.userId ?? "demo", name: viewer.name }), [viewer.userId, viewer.name]);
  const backend = useMemo(() => teamBackend(projectId, server, me), [projectId, server, me]);
  return { backend, me, server };
}

/**
 * Loads something now and again every few seconds while the page is visible,
 * so teammates' notes, messages and comments appear without a reload.
 */
export function usePolled<T>(load: () => Promise<T>, everyMs: number, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  });
  const refresh = useCallback(async () => {
    try {
      const next = await loadRef.current();
      setData(next);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load. Retrying.");
    }
  }, []);
  useEffect(() => {
    let stopped = false;
    const tick = () => {
      if (!stopped && document.visibilityState === "visible") void refresh();
    };
    tick();
    const timer = setInterval(tick, everyMs);
    document.addEventListener("visibilitychange", tick);
    return () => {
      stopped = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refresh, everyMs, ...deps]);
  return { data, setData, error, refresh };
}
