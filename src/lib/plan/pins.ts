import { describeSelection } from "./selection";
import type { EditResult, Plan, PlanItem, Point } from "./geometry";

/**
 * Pinning (Revit's PN): a pinned wall, column, room or piece of furniture
 * cannot be moved, turned, stretched or removed until it is unpinned, so the
 * existing shell is not knocked by accident. Every edit, by hand or by the
 * assistant, is checked against the pins before it is kept.
 */

export type PinKind = "wall" | "column" | "room" | "item";
export const PINNABLE: ReadonlySet<string> = new Set<PinKind>(["wall", "column", "room", "item"]);

type Pinnable = { id: string; pinned?: boolean };
const lists = (plan: Plan): Record<PinKind, Pinnable[]> => ({ wall: plan.walls, column: plan.columns, room: plan.rooms, item: plan.items });

export function isPinned(plan: Plan, t: PlanItem): boolean {
  if (!PINNABLE.has(t.kind)) return false;
  return !!lists(plan)[t.kind as PinKind].find((x) => x.id === t.id)?.pinned;
}

/** Where a pinned thing is: what must not change while it is pinned. */
function place(kind: PinKind, x: Pinnable): string {
  const p = (q: Point) => `${q.x.toFixed(2)},${q.y.toFixed(2)}`;
  if (kind === "wall") {
    const w = x as unknown as { a: Point; b: Point; levelId: string };
    return `${w.levelId}|${p(w.a)}|${p(w.b)}`;
  }
  if (kind === "room") {
    const r = x as unknown as { points: Point[]; levelId: string };
    return `${r.levelId}|${r.points.map(p).join(";")}`;
  }
  const i = x as unknown as { at: Point; levelId: string; width: number; depth: number; rotation?: number };
  return `${i.levelId}|${p(i.at)}|${i.width}|${i.depth}|${i.rotation ?? 0}`;
}

/** Why an edit may not be kept because it moves or removes something pinned, or null. */
export function pinViolation(before: Plan, after: Plan): string | null {
  const was = lists(before);
  const now = lists(after);
  const moved: PlanItem[] = [];
  for (const kind of Object.keys(was) as PinKind[]) {
    const pinned = was[kind].filter((x) => x.pinned);
    if (!pinned.length) continue;
    const next = new Map(now[kind].map((x) => [x.id, x]));
    for (const x of pinned) {
      const y = next.get(x.id);
      if (!y || (y.pinned && place(kind, x) !== place(kind, y))) moved.push({ kind, id: x.id });
    }
  }
  if (!moved.length) return null;
  return `${describeSelection(before, moved)} ${moved.length === 1 ? "is" : "are"} pinned. Unpin ${moved.length === 1 ? "it" : "them"} to move or remove ${moved.length === 1 ? "it" : "them"}.`;
}

/** Pins or unpins what is selected; things that cannot be pinned are left alone. */
export function pinMany(plan: Plan, selection: PlanItem[], pinned: boolean): EditResult {
  const want = new Map<PinKind, Set<string>>();
  for (const t of selection) if (PINNABLE.has(t.kind)) (want.get(t.kind as PinKind) ?? want.set(t.kind as PinKind, new Set()).get(t.kind as PinKind)!).add(t.id);
  if (!want.size) return { ok: false, error: "Walls, columns, rooms and furniture can be pinned." };
  const flip = <T extends Pinnable>(kind: PinKind, list: T[]): T[] =>
    list.map((x) => {
      if (!want.get(kind)?.has(x.id) || !!x.pinned === pinned) return x;
      const next = { ...x };
      if (pinned) next.pinned = true;
      else delete next.pinned;
      return next;
    });
  const next: Plan = { ...plan, walls: flip("wall", plan.walls), columns: flip("column", plan.columns), rooms: flip("room", plan.rooms), items: flip("item", plan.items) };
  const changed = selection.filter((t) => PINNABLE.has(t.kind) && isPinned(plan, t) !== pinned);
  if (!changed.length) return { ok: true, plan, summary: "" };
  return { ok: true, plan: next, summary: `${describeSelection(plan, changed)} ${pinned ? "pinned" : "unpinned"}` };
}
