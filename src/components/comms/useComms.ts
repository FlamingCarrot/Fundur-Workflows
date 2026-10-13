"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useStudio } from "@/components/providers/StudioProvider";
import { demoComms, serverComms, type CommsBackend } from "@/lib/comms/client";
import { useViewSetting } from "@/lib/view-settings/client";

/** The studio's conversations and meetings for one project: the server once signed in, this browser in the demo. */
export function useProjectComms(projectId: string): CommsBackend {
  const { persistence, viewer } = useStudio();
  const server = persistence === "server";
  const key = viewer.userId ?? "demo";
  return useMemo(
    () => (server ? serverComms(`/api/projects/${encodeURIComponent(projectId)}`, "team") : demoComms(projectId, { key, name: viewer.name, kind: "team" })),
    [server, projectId, key, viewer.name],
  );
}

/** An invited client's conversations and meetings, through their page's link. */
export function useClientComms(token: string): CommsBackend {
  return useMemo(() => serverComms(`/api/client/${encodeURIComponent(token)}`, "client"), [token]);
}

/**
 * Loads something now and again every few seconds while the page is visible,
 * so other people's posts appear without a reload. A failed refresh keeps
 * what was shown and says so.
 */
export function usePolling<T>(load: (() => Promise<T>) | null, everyMs: number, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  });
  const refresh = useCallback(async () => {
    if (!loadRef.current) return;
    try {
      const next = await loadRef.current();
      setData(next);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load. Retrying.");
    }
  }, []);
  useEffect(() => {
    // A different source (another channel or meeting) starts empty rather than showing the last one's data.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setData(null);
    if (!load) return;
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
  }, [refresh, everyMs, !!load, ...deps]);
  return { data, setData, error, refresh };
}

/** A view setting kept per person in the studio, and only for this visit on a client's page. */
export function useRemembered<T>(key: string, fallback: T, accept: (v: unknown) => v is T, remember: boolean): [T, (next: T) => void] {
  const [kept, setKept] = useViewSetting<T>(key, fallback, accept);
  const [local, setLocal] = useState<T>(fallback);
  return remember ? [kept, (v: T) => setKept(v)] : [local, setLocal];
}
