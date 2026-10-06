"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useStudio } from "@/components/providers/StudioProvider";
import { localRuleSets, serverRuleSets, type RuleSetBackend } from "@/lib/layout/client";
import type { RuleSet } from "@/lib/layout/rules";

/** The workspace's layout rule sets, loaded once and refreshed after each change. */
export function useRuleSets() {
  const { persistence, viewer } = useStudio();
  const backend: RuleSetBackend = useMemo(
    () => (persistence === "server" ? serverRuleSets : localRuleSets(viewer.name)),
    [persistence, viewer.name]
  );
  const [sets, setSets] = useState<RuleSet[] | null>(null);
  const [failed, setFailed] = useState(false);

  const reload = useCallback(async () => {
    try {
      const next = await backend.list();
      setSets(next);
      setFailed(false);
      return next;
    } catch {
      setFailed(true);
      return null;
    }
  }, [backend]);

  useEffect(() => {
    let live = true;
    backend
      .list()
      .then((next) => live && setSets(next))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [backend]);

  return { sets, failed, reload, backend };
}
