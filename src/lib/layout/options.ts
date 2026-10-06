import { levelOf, type EditResult, type Item, type LayoutOption, type Plan, type Point } from "@/lib/plan/geometry";

/**
 * Layout options kept in the plan (P4-02 to P4-05): saving the generated
 * ones, editing one in the plan editor, and choosing one. Each returns the new
 * plan and a line for the corrections log, like every other plan edit, so
 * options save, undo and keep versions with the plan itself.
 */

const fail = (error: string): EditResult => ({ ok: false, error });

/** The plan as it looks with an option's furniture on its floor instead of the plan's own. */
export function withLayout(plan: Plan, layout: LayoutOption): Plan {
  return { ...plan, items: [...plan.items.filter((i) => i.levelId !== layout.levelId), ...layout.items] };
}

/**
 * An edit made while an option is open, taken back into the plan: furniture on
 * the option's floor stays in the option; everything else (a wall moved, a
 * room renamed) changes the plan for every option.
 */
export function intoLayout(base: Plan, layoutId: string, result: EditResult): EditResult {
  if (!result.ok) return result;
  const layout = base.layouts.find((l) => l.id === layoutId);
  if (!layout) return fail("That option is no longer on the plan.");
  const items = result.plan.items.filter((i) => i.levelId === layout.levelId);
  return {
    ...result,
    plan: {
      ...result.plan,
      // The chosen option's furniture is the plan's, so editing it edits the plan's too.
      items: layout.chosen ? [...base.items.filter((i) => i.levelId !== layout.levelId), ...items] : base.items,
      layouts: base.layouts.map((l) => (l.id === layoutId ? { ...l, items } : l)),
    },
    summary: result.summary ? `${layout.name}: ${result.summary}` : result.summary,
  };
}

/** Saves newly generated options for a floor in place of the ones not chosen; a chosen option stays. */
export function saveOptions(plan: Plan, levelId: string, options: LayoutOption[]): EditResult {
  if (!options.length) return fail("There are no options to keep.");
  const chosen = plan.layouts.filter((l) => l.levelId === levelId && l.chosen);
  const taken = new Set(chosen.map((l) => l.name));
  // Fresh letters after any chosen option's, so names never repeat on a floor.
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").filter((c) => !taken.has(`Option ${c}`));
  const named = options.map((o, i) => ({ ...o, name: `Option ${letters[i] ?? i + 1}` }));
  return {
    ok: true,
    plan: { ...plan, layouts: [...plan.layouts.filter((l) => l.levelId !== levelId || l.chosen), ...named] },
    summary: `${named.length} layout option${named.length === 1 ? "" : "s"} made for ${levelOf(plan, levelId).name}`,
  };
}

/**
 * Chooses an option (P4-05): it is marked chosen with the reasons given, any
 * other chosen option on its floor is unmarked, and its furniture becomes the
 * plan's furniture on that floor, so exports and the concept phase use it.
 */
export function chooseLayout(plan: Plan, layoutId: string, notes: string, now = new Date()): EditResult {
  const layout = plan.layouts.find((l) => l.id === layoutId);
  if (!layout) return fail("That option is no longer on the plan.");
  const text = notes.trim().slice(0, 10_000);
  return {
    ok: true,
    plan: {
      ...plan,
      items: [...plan.items.filter((i) => i.levelId !== layout.levelId), ...layout.items],
      layouts: plan.layouts.map((l) =>
        l.id === layoutId
          ? { ...l, chosen: true, chosenAt: now.toISOString(), notes: text || undefined }
          : l.levelId === layout.levelId && l.chosen
            ? { ...l, chosen: false, chosenAt: undefined }
            : l
      ),
    },
    summary: `${layout.name} chosen for ${levelOf(plan, layout.levelId).name}; its furniture is now on the plan`,
  };
}

export function updateLayoutNotes(plan: Plan, layoutId: string, notes: string): EditResult {
  const layout = plan.layouts.find((l) => l.id === layoutId);
  if (!layout) return fail("That option is no longer on the plan.");
  const text = notes.trim().slice(0, 10_000);
  if ((layout.notes ?? "") === text) return { ok: true, plan, summary: "" };
  return {
    ok: true,
    plan: { ...plan, layouts: plan.layouts.map((l) => (l.id === layoutId ? { ...l, notes: text || undefined } : l)) },
    summary: `${layout.name}: notes ${text ? "updated" : "cleared"}`,
  };
}

export function removeLayout(plan: Plan, layoutId: string): EditResult {
  const layout = plan.layouts.find((l) => l.id === layoutId);
  if (!layout) return fail("That option is no longer on the plan.");
  return { ok: true, plan: { ...plan, layouts: plan.layouts.filter((l) => l.id !== layoutId) }, summary: `${layout.name} removed` };
}

/** The chosen option, the one the concept phase builds on: the first floor's, when more than one is chosen. */
export function chosenLayouts(plan: Plan): LayoutOption[] {
  const order = new Map(plan.levels.map((l, i) => [l.id, i]));
  return plan.layouts.filter((l) => l.chosen).sort((a, b) => (order.get(a.levelId) ?? 0) - (order.get(b.levelId) ?? 0));
}

// ---------------------------------------------------------------------------
// Snapping a dragged item to its neighbours (P4-04)
// ---------------------------------------------------------------------------

interface Extent {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/** An item's outline as an upright box, for items square to the page; null for any other angle. */
function extent(item: Item, at: Point = item.at): Extent | null {
  const r = ((item.rotation % 360) + 360) % 360;
  if (r % 90 !== 0) return null;
  const [w, d] = r % 180 === 0 ? [item.width, item.depth] : [item.depth, item.width];
  return { minX: at.x - w / 2, maxX: at.x + w / 2, minY: at.y - d / 2, maxY: at.y + d / 2 };
}

/**
 * Nudges a drag so the item's edges line up with, or butt against, a nearby
 * item's edges when they come within `within` mm, in x and y separately.
 * Items at other angles are left to the 10 mm grid.
 */
export function snapItemDelta(plan: Plan, levelId: string, itemId: string, delta: Point, within: number): Point {
  const item = plan.items.find((i) => i.id === itemId);
  if (!item) return delta;
  const moved = extent(item, { x: item.at.x + delta.x, y: item.at.y + delta.y });
  if (!moved) return delta;
  let bestX: number | null = null;
  let bestY: number | null = null;
  for (const other of plan.items) {
    if (other.id === itemId || other.levelId !== levelId) continue;
    const e = extent(other);
    if (!e) continue;
    // Only neighbours that overlap, or nearly, in the other direction.
    const nearInY = moved.maxY > e.minY - within && moved.minY < e.maxY + within;
    const nearInX = moved.maxX > e.minX - within && moved.minX < e.maxX + within;
    if (nearInY) {
      for (const shift of [e.maxX - moved.minX, e.minX - moved.maxX, e.minX - moved.minX, e.maxX - moved.maxX]) {
        if (Math.abs(shift) <= within && (bestX == null || Math.abs(shift) < Math.abs(bestX))) bestX = shift;
      }
    }
    if (nearInX) {
      for (const shift of [e.maxY - moved.minY, e.minY - moved.maxY, e.minY - moved.minY, e.maxY - moved.maxY]) {
        if (Math.abs(shift) <= within && (bestY == null || Math.abs(shift) < Math.abs(bestY))) bestY = shift;
      }
    }
  }
  return { x: delta.x + (bestX ?? 0), y: delta.y + (bestY ?? 0) };
}
