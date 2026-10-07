"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useStudio } from "@/components/providers/StudioProvider";
import { designBackend, SaveConflict } from "@/lib/design/client";
import {
  designDataSchema,
  type DesignData,
  type DesignState,
} from "@/lib/design/schema";

export function useDesign(projectId: string) {
  const { persistence, viewer } = useStudio();
  const scope = `${viewer.userId ?? "demo"}.${viewer.workspaceId ?? "demo"}`;
  const backend = useMemo(
    () => designBackend(projectId, scope, persistence === "server"),
    [projectId, scope, persistence],
  );
  const draftKey = `fundur.design.draft.${persistence}.${scope}.${projectId}`;
  const [data, setData] = useState<DesignData | null>(null),
    [error, setError] = useState("");
  const [status, setStatus] = useState("Loading…"),
    [conflict, setConflict] = useState<DesignState | null>(null);
  const current = useRef<DesignData | null>(null),
    revision = useRef(0),
    dirty = useRef(false),
    blocked = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null),
    running = useRef<Promise<boolean> | null>(null);
  const saveRef = useRef<() => Promise<boolean>>(async () => false);
  const keep = useCallback(() => {
    try {
      if (current.current)
        localStorage.setItem(
          draftKey,
          JSON.stringify({ data: current.current, revision: revision.current }),
        );
    } catch {
      setError(
        "This browser could not keep a recovery copy. Keep this page open until your changes are saved.",
      );
    }
  }, [draftKey]);
  const flush = useCallback(async (): Promise<boolean> => {
    if (timer.current) clearTimeout(timer.current);
    if (running.current) {
      await running.current;
      return !blocked.current && dirty.current
        ? saveRef.current()
        : !dirty.current;
    }
    if (!dirty.current) return true;
    if (blocked.current || !current.current) return false;
    const sent = current.current;
    const work = (async () => {
      setStatus("Saving…");
      setError("");
      try {
        const saved = await backend.save(sent, revision.current);
        revision.current = saved.revision;
        if (current.current === sent) {
          dirty.current = false;
          try {
            localStorage.removeItem(draftKey);
          } catch {
            /* Saving succeeded even if browser cleanup is blocked. */
          }
          setStatus("Saved");
        } else {
          keep();
          setStatus("Unsaved changes");
          timer.current = setTimeout(() => void saveRef.current(), 700);
        }
        return true;
      } catch (e) {
        if (e instanceof SaveConflict) {
          blocked.current = true;
          setConflict(e.current);
          setStatus("Changed elsewhere");
        } else {
          setStatus("Not saved");
          setError((e as Error).message);
        }
        return false;
      }
    })();
    running.current = work;
    let ok = false;
    try {
      ok = await work;
    } finally {
      running.current = null;
    }
    return ok && dirty.current && !blocked.current ? saveRef.current() : ok;
  }, [backend, draftKey, keep]);
  useEffect(() => {
    saveRef.current = flush;
  }, [flush]);
  useEffect(() => {
    let active = true;
    backend.load().then(
      (state) => {
        if (!active) return;
        revision.current = state.revision;
        let initial = state.data;
        try {
          const raw = localStorage.getItem(draftKey);
          if (raw) {
            const draft = JSON.parse(raw);
            const parsed = designDataSchema.safeParse(draft.data);
            if (parsed.success) {
              initial = parsed.data;
              dirty.current = true;
              if (draft.revision !== state.revision) {
                blocked.current = true;
                setConflict(state);
                setStatus("Changed elsewhere");
              } else {
                setStatus("Recovered draft");
                timer.current = setTimeout(() => void saveRef.current(), 700);
              }
            }
          }
        } catch {
          setError(
            "A recovery copy could not be read. The saved project is shown.",
          );
        }
        current.current = initial;
        setData(initial);
        if (!dirty.current) setStatus("Saved");
      },
      (e) => {
        if (active) {
          setError(e.message);
          setStatus("Could not load");
        }
      },
    );
    const beforeUnload = (e: BeforeUnloadEvent) => {
      if (dirty.current) {
        keep();
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      active = false;
      if (timer.current) clearTimeout(timer.current);
      window.removeEventListener("beforeunload", beforeUnload);
    };
  }, [backend, draftKey, keep]);
  const update = (fn: (data: DesignData) => DesignData) => {
    if (!current.current) return;
    const next = fn(current.current);
    if (next === current.current) return;
    const parsed = designDataSchema.safeParse(next);
    if (!parsed.success) {
      setError(parsed.error.issues[0].message);
      return;
    }
    current.current = parsed.data;
    setData(parsed.data);
    dirty.current = true;
    keep();
    setStatus(blocked.current ? "Changed elsewhere" : "Unsaved changes");
    if (timer.current) clearTimeout(timer.current);
    if (!blocked.current)
      timer.current = setTimeout(() => void saveRef.current(), 700);
  };
  const resolve = (useSaved: boolean) => {
    if (!conflict) return;
    revision.current = conflict.revision;
    blocked.current = false;
    if (useSaved) {
      current.current = conflict.data;
      setData(conflict.data);
      dirty.current = false;
      try {
        localStorage.removeItem(draftKey);
      } catch {
        /* The saved state remains usable if browser storage is blocked. */
      }
      setStatus("Saved");
    } else {
      keep();
      dirty.current = true;
      void saveRef.current();
    }
    setConflict(null);
  };
  return { data, error, status, conflict, update, flush, resolve };
}
