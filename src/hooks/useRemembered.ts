"use client";

import { useCallback, useEffect, useState } from "react";

const PREFIX = "fundur.view.";

/**
 * A view setting that is kept when she leaves and restored when she comes
 * back (toggles, filters, zoom). It starts from `initial` on the server and
 * on first paint, then takes the saved value, so the page never mismatches.
 * Saved values are merged over `initial`, so a setting added later still
 * gets its default.
 */
export function useRemembered<T extends object>(key: string, initial: T): [T, (next: T | ((current: T) => T)) => void] {
  const [value, setValue] = useState<T>(initial);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(PREFIX + key);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- read once after mount, so server and first paint agree
      if (raw) setValue({ ...initial, ...(JSON.parse(raw) as Partial<T>) });
    } catch {
      // Nothing saved, or storage is unavailable: the defaults stand.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const set = useCallback(
    (next: T | ((current: T) => T)) => {
      setValue((current) => {
        const value = typeof next === "function" ? (next as (c: T) => T)(current) : next;
        try {
          window.localStorage.setItem(PREFIX + key, JSON.stringify(value));
        } catch {
          // Private mode: the setting lasts for this visit.
        }
        return value;
      });
    },
    [key]
  );

  return [value, set];
}
