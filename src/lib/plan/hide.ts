import type { Plan, PlanItem, PlanItemKind } from "./geometry";

/**
 * Revit's Temporary Hide/Isolate: hide some things to see past them, or
 * isolate some to see only them. It changes what is drawn and picked, never
 * the plan itself, so every edit still lands on the whole plan.
 */

export interface HideState {
  mode: "hide" | "isolate";
  /** `kind:id` keys of the things hidden, or the only things shown. */
  keys: string[];
}

export const keyFor = (t: PlanItem) => `${t.kind}:${t.id}`;

const KINDS: PlanItemKind[] = ["wall", "opening", "column", "room", "item", "note", "dimension"];
export const isHideState = (v: unknown): v is HideState | null => {
  if (v === null) return true;
  const h = v as HideState;
  return !!h && (h.mode === "hide" || h.mode === "isolate") && Array.isArray(h.keys) && h.keys.length <= 5000 && h.keys.every((k) => typeof k === "string" && KINDS.includes(k.split(":")[0] as PlanItemKind));
};

/** Starts hiding or isolating these things; hiding more adds to what is already hidden. */
export function hideThese(current: HideState | null, mode: "hide" | "isolate", things: PlanItem[]): HideState | null {
  const keys = things.map(keyFor);
  if (!keys.length) return current;
  if (mode === "hide" && current?.mode === "hide") return { mode, keys: [...new Set([...current.keys, ...keys])] };
  return { mode, keys: [...new Set(keys)] };
}

/** The plan as drawn: without what is hidden, or with only what is isolated. */
export function visiblePart(plan: Plan, state: HideState | null): Plan {
  if (!state || !state.keys.length) return plan;
  const set = new Set(state.keys);
  const shown = (kind: PlanItemKind, id: string) => (state.mode === "hide" ? !set.has(`${kind}:${id}`) : set.has(`${kind}:${id}`));
  const walls = plan.walls.filter((w) => shown("wall", w.id));
  const wallIds = new Set(walls.map((w) => w.id));
  return {
    ...plan,
    walls,
    // A door goes with its wall; isolating a wall keeps its doors and windows.
    openings: plan.openings.filter((o) => wallIds.has(o.wallId) && (state.mode === "isolate" ? shown("opening", o.id) || shown("wall", o.wallId) : shown("opening", o.id))),
    columns: plan.columns.filter((c) => shown("column", c.id)),
    rooms: plan.rooms.filter((r) => shown("room", r.id)),
    items: plan.items.filter((i) => shown("item", i.id)),
    notes: plan.notes.filter((n) => shown("note", n.id)),
    dimensions: plan.dimensions.filter((d) => shown("dimension", d.id)),
  };
}

/** How many things the state leaves out of the plan, for the "Show all" bar. */
export function hiddenCount(plan: Plan, state: HideState | null): number {
  if (!state) return 0;
  const seen = visiblePart(plan, state);
  const count = (p: Plan) => p.walls.length + p.openings.length + p.columns.length + p.rooms.length + p.items.length + p.notes.length + p.dimensions.length;
  return count(plan) - count(seen);
}
