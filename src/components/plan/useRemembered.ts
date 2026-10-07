"use client";

import { useEffect, useState } from "react";

/**
 * A view setting kept in this browser and put back next time, as every view
 * setting in the app is. Nothing breaks when storage is unavailable: the
 * setting just starts from its default.
 */
export function useRemembered<T>(key: string, fallback: T, accept: (value: unknown) => T | null = (v) => v as T): [T, (next: T | ((prev: T) => T)) => void] {
  const storageKey = `fundur.view.${key}`;
  const [value, setValue] = useState<T>(fallback);
  const [loaded, setLoaded] = useState(false);

  // Read once on the client; the server render always uses the default.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(storageKey);
      const parsed = raw == null ? null : accept(JSON.parse(raw));
      // eslint-disable-next-line react-hooks/set-state-in-effect -- the stored value only exists in the browser
      if (parsed != null) setValue(parsed);
    } catch {
      // Unreadable or blocked storage: keep the default.
    }
    setLoaded(true);
    // Read once per key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  useEffect(() => {
    if (!loaded) return;
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(value));
    } catch {
      // Storage full or blocked: the setting lasts for this visit only.
    }
  }, [loaded, storageKey, value]);

  return [value, setValue];
}
