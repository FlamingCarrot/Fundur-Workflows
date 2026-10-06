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

  useEffect(() => {
    latestValueRef.current = value;

    // Check if the value actually changed
    const isDifferent = JSON.stringify(value) !== JSON.stringify(lastSavedValueRef.current);
    if (!isDifferent) {
      return;
    }

    setStatus("dirty");

    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    timeoutRef.current = setTimeout(async () => {
      try {
        setStatus("saving");
        await onSave(latestValueRef.current);
        lastSavedValueRef.current = latestValueRef.current;
        setStatus("saved");
        setLastSavedAt(new Date());
      } catch (err) {
        setStatus("error");
        if (onError) onError(err);
      }
    }, debounceMs);

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [value, debounceMs, onSave, onError]);

  // Force an immediate save (e.g. before navigating or completing phase)
  const flush = useCallback(async () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    const isDifferent = JSON.stringify(latestValueRef.current) !== JSON.stringify(lastSavedValueRef.current);
    if (isDifferent) {
      try {
        setStatus("saving");
        await onSave(latestValueRef.current);
        lastSavedValueRef.current = latestValueRef.current;
        setStatus("saved");
        setLastSavedAt(new Date());
      } catch (err) {
        setStatus("error");
        if (onError) onError(err);
      }
    }
  }, [onSave, onError]);

  return { status, lastSavedAt, flush };
}
