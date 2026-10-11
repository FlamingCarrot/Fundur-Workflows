"use client";

import { useCallback, useSyncExternalStore } from "react";
import { applyPlannerOp, emptyPlanner, normalizePlanner, PlannerError, type PlannerOp, type PlannerState } from "./state";

/**
 * The browser's copy of the planner. Changes show at once; with the server set
 * up they are sent in order, and each saved copy that comes back has the
 * changes still on their way laid over it, so nothing flickers back. In the
 * demo the planner is kept in this browser.
 */

const STORAGE_KEY = "fundur.planner.v1";

interface Snapshot {
  state: PlannerState;
  ready: boolean;
}

let confirmed: PlannerState = emptyPlanner();
let pending: PlannerOp[] = [];
let snapshot: Snapshot = { state: confirmed, ready: false };
let server = false;
let started = false;
let chain: Promise<unknown> = Promise.resolve();
const listeners = new Set<() => void>();

function publish(ready = snapshot.ready) {
  let state = confirmed;
  for (const op of pending) {
    try {
      state = applyPlannerOp(state, op);
    } catch {
      // A change that no longer fits on the saved copy is dropped when the server says so.
    }
  }
  snapshot = { state, ready };
  for (const l of listeners) l();
}

function saveLocally() {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(confirmed));
  } catch {
    // A full or blocked store: changes last for this visit only.
  }
}

async function call(init?: RequestInit): Promise<PlannerState> {
  const res = await fetch("/api/planner", { ...init, headers: { "content-type": "application/json" } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new PlannerError(body.error ?? `Request failed (${res.status})`);
  return normalizePlanner(body.state);
}

/** Loads the planner, from the server or this browser. Safe to call more than once. */
export function startPlanner(useServer: boolean) {
  if (started && server === useServer) return;
  started = true;
  server = useServer;
  if (!useServer) {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      confirmed = normalizePlanner(raw ? JSON.parse(raw) : null);
    } catch {
      confirmed = emptyPlanner();
    }
    publish(true);
    return;
  }
  call().then(
    (state) => {
      confirmed = state;
      publish(true);
    },
    () => publish(true)
  );
}

/**
 * Makes changes, in order. Resolves once they are saved; rejects with the
 * reason when one does not fit, and the screen goes back to the saved copy.
 */
export function changePlanner(input: PlannerOp | PlannerOp[]): Promise<void> {
  const ops = Array.isArray(input) ? input : [input];
  // Refuse at once what cannot apply here, before showing it.
  let check = snapshot.state;
  for (const op of ops) check = applyPlannerOp(check, op);
  if (!server) {
    confirmed = check;
    saveLocally();
    publish();
    return Promise.resolve();
  }
  pending.push(...ops);
  publish();
  const run = chain.then(async () => {
    try {
      const state = await call({ method: "POST", body: JSON.stringify({ ops }) });
      confirmed = state;
      pending = pending.slice(ops.length);
      publish();
    } catch (err) {
      pending = pending.slice(ops.length);
      // Whatever the server holds now is what to show.
      confirmed = await call().catch(() => confirmed);
      publish();
      throw err;
    }
  });
  chain = run.catch(() => undefined);
  return run;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const serverSnapshot: Snapshot = { state: emptyPlanner(), ready: false };

/** The planner as it stands, whether it has loaded, and the way to change it. */
export function usePlanner() {
  const { state, ready } = useSyncExternalStore(subscribe, () => snapshot, () => serverSnapshot);
  const change = useCallback((input: PlannerOp | PlannerOp[]) => changePlanner(input), []);
  return { planner: state, ready, change };
}

/** A fresh id for a list, to-do or column. */
export function newId(): string {
  return crypto.randomUUID();
}
