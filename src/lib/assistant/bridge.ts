"use client";

import { useSyncExternalStore } from "react";
import type { Plan, PlanItem } from "@/lib/plan/geometry";
import type { BlueprintViewCommand, ViewCommand, ViewState } from "./view-command";
import type { DesignBoard } from "@/lib/design/schema";

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

/** A mood board open on screen, and what she has selected on it. */
export interface BoardFocus {
  projectId: string;
  boardKey: string;
  selection: string[];
  /** "3 stickies", for the chip over the message box. */
  selectionLabel: string;
}

export interface BoardHost {
  projectId: string;
  boardKey: string;
  /** Saves any edits not yet saved; false when that failed. */
  flush: () => Promise<boolean>;
  /** Shows a board the assistant saved; false when the board has its own unsaved edits. */
  adopt: (board: DesignBoard | null, revision: number) => boolean;
}

/** The blueprint open in the blueprint editor and what she has picked in it. */
export interface BlueprintFocus {
  blueprintId: string;
  parts: string[];
  /** Picked points of the one selected part, while editing points. */
  points: number[];
  handles: string;
}

export interface BlueprintHost {
  blueprintId: string;
  /** Saves her unsaved edits so the assistant works on what she sees; false when that failed. */
  flush: () => Promise<boolean>;
  /** Selects, switches handles or changes the view as the assistant asked; returns what it did. */
  view: (command: BlueprintViewCommand) => string;
}

let blueprintFocus: BlueprintFocus | null = null;
let blueprintHost: BlueprintHost | null = null;

let boardFocus: BoardFocus | null = null;
let boardHost: BoardHost | null = null;

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
  setBoardFocus(next: BoardFocus | null) {
    boardFocus = next;
    notify();
  },
  setBoardHost(next: BoardHost | null) {
    boardHost = next;
  },
  releaseBoard(projectId: string, boardKey: string) {
    if (boardHost?.projectId === projectId && boardHost.boardKey === boardKey) boardHost = null;
    if (boardFocus?.projectId === projectId && boardFocus.boardKey === boardKey) {
      boardFocus = null;
      notify();
    }
  },
  setBlueprint(f: BlueprintFocus | null, h: BlueprintHost | null) {
    blueprintFocus = f;
    blueprintHost = h;
  },
  releaseBlueprint(blueprintId: string) {
    if (blueprintHost?.blueprintId === blueprintId) blueprintHost = null;
    if (blueprintFocus?.blueprintId === blueprintId) blueprintFocus = null;
  },
  blueprint(blueprintId: string | undefined): { focus: BlueprintFocus | null; host: BlueprintHost | null } {
    return {
      focus: blueprintFocus?.blueprintId === blueprintId ? blueprintFocus : null,
      host: blueprintHost?.blueprintId === blueprintId ? blueprintHost : null,
    };
  },
  boardHost(projectId: string): BoardHost | null {
    return boardHost?.projectId === projectId ? boardHost : null;
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

/** The mood board open for this project and what is selected on it, live; null when none is open. */
export function useBoardFocus(projectId: string | undefined): BoardFocus | null {
  const current = useSyncExternalStore(subscribe, () => boardFocus, () => null);
  return current && current.projectId === projectId ? current : null;
}
