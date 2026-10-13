"use client";

import { useSyncExternalStore } from "react";
import type { Plan, PlanItem } from "@/lib/plan/geometry";
import type { ViewCommand, ViewState } from "./view-command";

/**
 * How the assistant and the screen she is working on talk in the browser. The
 * plan editor says which floor she is on and what she has selected, so the
 * chat can show it and send it with her message; before a message is sent the
 * editor saves, so the assistant reads what she sees; and plan edits the
 * assistant saves are handed to the editor to draw at once.
 */

export interface PlanFocus {
  projectId: string;
  levelId: string;
  levelName: string;
  selection: PlanItem[];
  /** "2 desks, a wall", for the chip over the message box. */
  selectionLabel: string;
  /** The editor's view, sent with her message so the assistant knows what she sees. */
  view?: ViewState;
}

export interface PlanHost {
  projectId: string;
  /** Saves any edits not yet saved; false when that failed. */
  flush: () => Promise<boolean>;
  /** Draws a plan the assistant saved; false when the editor has its own unsaved edits. */
  adopt: (plan: Plan, revision: number, summary: string) => boolean;
  /** Changes the view as the assistant asked; returns what it did, or why not. */
  view?: (command: ViewCommand) => string;
}

let focus: PlanFocus | null = null;
let host: PlanHost | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

export const assistantBridge = {
  setFocus(next: PlanFocus | null) {
    focus = next;
    notify();
  },
  setHost(next: PlanHost | null) {
    host = next;
  },
  /** Clears both, but only if they still belong to this project (a newer editor may have taken over). */
  release(projectId: string) {
    if (host?.projectId === projectId) host = null;
    if (focus?.projectId === projectId) {
      focus = null;
      notify();
    }
  },
  host(projectId: string): PlanHost | null {
    return host?.projectId === projectId ? host : null;
  },
};

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** The plan editor's floor and selection for this project, live; null when no editor is open on it. */
export function usePlanFocus(projectId: string | undefined): PlanFocus | null {
  const current = useSyncExternalStore(subscribe, () => focus, () => null);
  return current && current.projectId === projectId ? current : null;
}
