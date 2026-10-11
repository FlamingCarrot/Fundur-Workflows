"use client";

import { useCallback, useSyncExternalStore } from "react";
import type { ViewSettings } from "./schema";

/**
 * Screens open the way they were left: the calendar on the view last picked,
 * the projects list on its last filter, a plan at its last zoom. Every setting
 * is kept in this browser so it is there at once, and, once the server is set
 * up, saved for the signed-in person so it follows them to another device.
 */

const STORAGE_KEY = "fundur.viewSettings.v1";
const SAVE_DELAY_MS = 800;

type Listener = () => void;

let values: ViewSettings | null = null;
const listeners = new Set<Listener>();
// Settings changed here that the server has not been sent yet.
let unsent: ViewSettings = {};
let server = false;
// Whether the server's copy has arrived; there is none to wait for without one.
let loaded = true;
let timer: ReturnType<typeof setTimeout> | undefined;

function load(): ViewSettings {
  if (values) return values;
  values = {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) values = JSON.parse(raw) as ViewSettings;
  } catch {
    // Storage blocked or unreadable: settings last for this visit only.
  }
  return values;
}

function persistLocally() {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(values));
  } catch {
    // A full or blocked store: settings last for this visit only.
  }
}

function emit() {
  for (const l of listeners) l();
}

function flush(keepalive = false) {
  clearTimeout(timer);
  if (!server || !Object.keys(unsent).length) return;
  const settings = unsent;
  unsent = {};
  fetch("/api/view-settings", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ settings }),
    keepalive,
  })
    .then((res) => {
      if (!res.ok) throw new Error(`Saving view settings failed (${res.status})`);
    })
    .catch(() => {
      // Offline or refused: keep them for the next save, unless something newer replaced them.
      unsent = { ...settings, ...unsent };
    });
}

export function getViewSetting(key: string): unknown {
  return load()[key];
}

export function setViewSetting(key: string, value: unknown) {
  const current = load();
  if (current[key] === value) return;
  values = { ...current };
  if (value === undefined) delete values[key];
  else values[key] = value;
  persistLocally();
  emit();
  if (server) {
    unsent[key] = value === undefined ? null : value;
    clearTimeout(timer);
    timer = setTimeout(() => flush(), SAVE_DELAY_MS);
  }
}

function subscribe(listener: Listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Loads the signed-in person's settings from the server and keeps sending
 * changes there. Their saved settings replace whatever this browser held
 * (it may have been someone else's), except changes made since the page opened.
 */
export function startServerViewSettings(): () => void {
  server = true;
  loaded = false;
  let cancelled = false;
  fetch("/api/view-settings")
    .then((res) => (res.ok ? (res.json() as Promise<{ settings: ViewSettings }>) : null))
    .then((body) => {
      if (cancelled || !body) return;
      const pending = Object.fromEntries(Object.entries(unsent).filter(([, v]) => v !== null));
      values = { ...body.settings, ...pending };
      persistLocally();
    })
    .catch(() => undefined)
    .finally(() => {
      if (cancelled) return;
      loaded = true;
      emit();
    });
  const onHide = () => document.visibilityState === "hidden" && flush(true);
  document.addEventListener("visibilitychange", onHide);
  window.addEventListener("pagehide", onHide);
  return () => {
    cancelled = true;
    flush(true);
    server = false;
    loaded = true;
    document.removeEventListener("visibilitychange", onHide);
    window.removeEventListener("pagehide", onHide);
  };
}

/**
 * False while the signed-in person's saved settings are still on their way,
 * so a screen that remembers something it measures (like a plan's zoom) can
 * wait for them before saving over them.
 */
export function useViewSettingsLoaded(): boolean {
  return useSyncExternalStore(subscribe, () => loaded, () => false);
}

/** Forgets every setting held in memory; for tests. */
export function resetViewSettings() {
  values = null;
  unsent = {};
  server = false;
  loaded = true;
  clearTimeout(timer);
}

/**
 * A view setting as state: how the screen was last left, or `fallback` when
 * it never was or the saved value no longer fits (`accept` says what fits).
 * Pass a `fallback` and `accept` that keep their identity between renders.
 */
export function useViewSetting<T>(
  key: string,
  fallback: T,
  accept: (value: unknown) => value is T
): [T, (next: T | ((current: T) => T)) => void] {
  const raw = useSyncExternalStore(
    subscribe,
    () => getViewSetting(key),
    () => undefined
  );
  const value = raw !== undefined && accept(raw) ? raw : fallback;
  const set = useCallback(
    (next: T | ((current: T) => T)) => {
      const stored = getViewSetting(key);
      const current = stored !== undefined && accept(stored) ? stored : fallback;
      setViewSetting(key, typeof next === "function" ? (next as (c: T) => T)(current) : next);
    },
    [key, fallback, accept]
  );
  return [value, set];
}

/** Accepts one of the listed values. */
export function oneOf<T extends string>(options: readonly T[]) {
  return (value: unknown): value is T => typeof value === "string" && (options as readonly string[]).includes(value);
}

export const isBoolean = (value: unknown): value is boolean => typeof value === "boolean";

export const isString = (value: unknown): value is string => typeof value === "string";

export const isStringOrNull = (value: unknown): value is string | null => value === null || typeof value === "string";
