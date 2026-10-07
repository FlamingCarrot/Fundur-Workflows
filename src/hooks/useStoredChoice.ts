"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * A view choice (a filter, a tab) that is saved as it changes and comes back
 * when the person returns. Kept in this browser; unknown saved values fall
 * back to the default.
 */
export function useStoredChoice<T extends string>(key: string, initial: T, allowed: readonly T[]): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(initial);
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(key) as T | null;
      // Read after mount so the server render and the first client render match.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (saved && allowed.includes(saved)) setValue(saved);
    } catch {
      // Storage can be unavailable (private mode); the default stands.
    }
    // `allowed` is a fixed list per caller.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const choose = useCallback(
    (next: T) => {
      setValue(next);
      try {
        window.localStorage.setItem(key, next);
      } catch {
        // Kept for this visit only.
      }
    },
    [key]
  );
  return [value, choose];
}
