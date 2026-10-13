import type { EditResult, Plan, PlanItem } from "./geometry";

/**
 * Phasing, as in a fit-out drawing: the shell and anything kept is existing,
 * what comes out is demolished, and the rest is new work. Walls, doors and
 * windows, columns and furniture each carry a phase (none means new), and a
 * phase view chooses what is drawn: the existing survey, the demolition plan,
 * the new layout, or everything with the phase graphics.
 */

export type Phase = "existing" | "demolished" | "new";
export const PHASES: { key: Phase; label: string }[] = [
  { key: "existing", label: "Existing" },
  { key: "demolished", label: "To demolish" },
  { key: "new", label: "New" },
];

export type PhaseView = "all" | "existing" | "demolition" | "new";
export const PHASE_VIEWS: { key: PhaseView; label: string; hint: string }[] = [
  { key: "all", label: "All phases", hint: "Everything, drawn by phase" },
  { key: "existing", label: "As it is", hint: "Existing and to demolish, before any work" },
  { key: "demolition", label: "Demolition", hint: "Existing, with what comes out dashed" },
  { key: "new", label: "New layout", hint: "Existing that stays, and new work" },
];
export const isPhaseView = (v: unknown): v is PhaseView => PHASE_VIEWS.some((p) => p.key === v);

export const PHASED = new Set<PlanItem["kind"]>(["wall", "opening", "column", "item"]);
export const phaseOf = (t: { phase?: Phase }): Phase => t.phase ?? "new";

/** Whether a phase is drawn in a view. */
export function inView(phase: Phase, view: PhaseView): boolean {
  if (view === "all") return true;
  if (view === "new") return phase !== "demolished";
  return phase !== "new";
}

/** Whether the plan uses phases at all, so plans without them look as they always did. */
export const usesPhases = (plan: Plan) => [plan.walls, plan.openings, plan.columns, plan.items].some((list) => list.some((t) => !!t.phase));

/** The plan as a phase view draws it. A door on a wall that is not drawn is not drawn either. */
export function phaseView(plan: Plan, view: PhaseView): Plan {
  if (view === "all") return plan;
  const keep = <T extends { phase?: Phase }>(t: T) => inView(phaseOf(t), view);
  const walls = plan.walls.filter(keep);
  const wallIds = new Set(walls.map((w) => w.id));
  return {
    ...plan,
    walls,
    openings: plan.openings.filter((o) => wallIds.has(o.wallId) && keep(o)),
    columns: plan.columns.filter(keep),
    items: plan.items.filter(keep),
  };
}

/**
 * Sets the phase of walls, doors and windows, columns and furniture. A wall
 * to demolish takes its doors and windows with it; an existing wall's new
 * doors stay new, as a door cut into the shell is new work.
 */
export function setPhase(plan: Plan, things: PlanItem[], phase: Phase): EditResult {
  const ids = (kind: PlanItem["kind"]) => new Set(things.filter((t) => t.kind === kind).map((t) => t.id));
  const walls = ids("wall");
  const openings = ids("opening");
  const columns = ids("column");
  const items = ids("item");
  const count = walls.size + openings.size + columns.size + items.size;
  if (!count) return { ok: false, error: "Only walls, doors, windows, columns and furniture have a phase." };
  const value = phase === "new" ? undefined : phase;
  const set = <T extends { id: string; phase?: Phase }>(t: T, hit: boolean): T => {
    if (!hit) return t;
    const next = { ...t, phase: value };
    if (!value) delete next.phase;
    return next;
  };
  const next: Plan = {
    ...plan,
    walls: plan.walls.map((w) => set(w, walls.has(w.id))),
    openings: plan.openings.map((o) => set(o, openings.has(o.id) || (phase === "demolished" && walls.has(o.wallId)))),
    columns: plan.columns.map((c) => set(c, columns.has(c.id))),
    items: plan.items.map((i) => set(i, items.has(i.id))),
  };
  // A door cannot stay while its wall comes down.
  const demolishedWalls = new Set(next.walls.filter((w) => w.phase === "demolished").map((w) => w.id));
  if (next.openings.some((o) => demolishedWalls.has(o.wallId) && o.phase !== "demolished")) return { ok: false, error: "A door or window would stay in a wall that comes down. Set the wall's phase instead." };
  const label = PHASES.find((p) => p.key === phase)!.label.toLowerCase();
  return { ok: true, plan: next, summary: `${count === 1 ? "One thing" : `${count} things`} set to ${label}` };
}
