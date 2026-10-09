"use client";
import { useState } from "react";

/** Drafts remain private to the account, workspace and project named in the key. */
export function useTextDraft(key: string, initialValue = "") {
  const [input, setInput] = useState(() => {
    try {
      return typeof window === "undefined"
        ? initialValue
        : (localStorage.getItem(key) || initialValue).slice(0, 20_000);
    } catch {
      return initialValue;
    }
  });
  return [
    input,
    (value: string) => {
      setInput(value);
      try {
        if (value) localStorage.setItem(key, value);
        else localStorage.removeItem(key);
      } catch {
        /* The conversation still works if browser storage is unavailable. */
      }
    },
  ] as const;
}
