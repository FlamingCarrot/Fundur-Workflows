"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useStudio } from "@/components/providers/StudioProvider";
import { sourcingLibrary } from "@/lib/sourcing/client";
import type { SourcingEntry, SourcingEntryInput } from "@/lib/sourcing/schema";
export function useSourcingLibrary() {
  const { viewer, persistence } = useStudio();
  const allowed =
    persistence !== "server" ||
    viewer.workspaceRole === "owner" ||
    viewer.workspaceRole === "member";
  const service = useMemo(
    () =>
      sourcingLibrary(
        persistence === "server",
        `${viewer.userId ?? "demo"}.${viewer.workspaceId ?? "demo"}`,
      ),
    [persistence, viewer.userId, viewer.workspaceId],
  );
  const [entries, setEntries] = useState<SourcingEntry[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const reload = useCallback(async () => {
    if (!allowed) return;
    setBusy(true);
    try {
      setEntries(await service.list());
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [allowed, service]);
  useEffect(() => {
    let active = true;
    if (allowed)
      service.list().then(
        (rows) => {
          if (active) setEntries(rows);
        },
        (e) => {
          if (active) setError(e.message);
        },
      );
    return () => {
      active = false;
    };
  }, [allowed, service]);
  const save = async (input: SourcingEntryInput) => {
    setBusy(true);
    try {
      const entry = await service.save(input);
      setEntries((rows) => [...rows.filter((r) => r.id !== entry.id), entry]);
      setError("");
      return entry;
    } catch (e) {
      setError((e as Error).message);
      throw e;
    } finally {
      setBusy(false);
    }
  };
  const remove = async (id: string) => {
    setBusy(true);
    try {
      await service.remove(id);
      setEntries((rows) => rows.filter((r) => r.id !== id));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return { allowed, entries, error, busy, reload, save, remove };
}
