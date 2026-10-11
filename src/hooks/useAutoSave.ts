"use client";

import { useEffect, useRef, useState, useCallback } from "react";

export type SaveStatus = "saved" | "saving" | "dirty" | "error";

interface UseAutoSaveOptions<T> {
  value: T;
  onSave: (val: T) => Promise<void> | void;
  debounceMs?: number;
  onError?: (err: unknown) => void;
}

export function useAutoSave<T>({
  value,
  onSave,
  debounceMs = 800,
  onError,
}: UseAutoSaveOptions<T>) {
  const [status, setStatus] = useState<SaveStatus>("saved");
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(new Date());
  const latestValueRef = useRef<T>(value);
  const lastSavedValueRef = useRef<T>(value);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const running = useRef<Promise<boolean> | null>(null);

  const flush = useCallback(
    async function savePending(): Promise<boolean> {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      if (running.current) {
        if (!(await running.current)) return false;
        return savePending();
      }
      if (
        JSON.stringify(latestValueRef.current) ===
        JSON.stringify(lastSavedValueRef.current)
      )
        return true;
      // A value typed during this request must not be marked saved by its predecessor.
      const sent = latestValueRef.current;
      const work = (async () => {
        setStatus("saving");
        try {
          await onSave(sent);
          lastSavedValueRef.current = sent;
          setLastSavedAt(new Date());
          setStatus(
            JSON.stringify(latestValueRef.current) === JSON.stringify(sent)
              ? "saved"
              : "dirty",
          );
          return true;
        } catch (err) {
          setStatus("error");
          onError?.(err);
          return false;
        }
      })();
      running.current = work;
      const ok = await work;
      if (running.current === work) running.current = null;
      return ok &&
        JSON.stringify(latestValueRef.current) !==
          JSON.stringify(lastSavedValueRef.current)
        ? savePending()
        : ok;
    },
    [onSave, onError],
  );

  useEffect(() => {
    latestValueRef.current = value;

    // Check if the value actually changed
    const isDifferent =
      JSON.stringify(value) !== JSON.stringify(lastSavedValueRef.current);
    if (!isDifferent) {
      return;
    }

    setStatus("dirty");

    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    timeoutRef.current = setTimeout(() => void flush(), debounceMs);

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [value, debounceMs, flush]);

  return { status, lastSavedAt, flush };
}
