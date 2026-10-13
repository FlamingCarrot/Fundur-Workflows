import { distance, finite, LIMITS, mm, newId, openingsFit, wallLength, type EditResult, type Opening, type Plan, type Point, type Wall } from "./geometry";

/**
 * Revit's wall-editing tools: Split Element (SL) cuts a wall in two at a
 * point, Trim/Extend to Corner (TR) makes two walls meet at a corner, and
 * Offset (OF) puts a parallel copy of a wall a set distance to one side. Each
 * is an ordinary plan edit, versioned and undoable.
 */

const fail = (error: string): EditResult => ({ ok: false, error });
const halfOpening = (o: Opening) => o.width / 2;

/** Cuts a wall in two at the point on it nearest `at`; doors and windows stay where they are. */
export function splitWall(plan: Plan, wallId: string, at: Point): EditResult {
  const wall = plan.walls.find((w) => w.id === wallId);
  if (!wall) return fail("That wall is no longer on the plan.");
  if (!finite(at.x, at.y)) return fail("That point is off the plan.");
  const length = wallLength(wall);
  const dx = (wall.b.x - wall.a.x) / (length || 1);
  const dy = (wall.b.y - wall.a.y) / (length || 1);
  const along = Math.round((at.x - wall.a.x) * dx + (at.y - wall.a.y) * dy);
  if (along < LIMITS.minWall || length - along < LIMITS.minWall) return fail(`Split at least ${mm(LIMITS.minWall)} from either end.`);
  const openings = plan.openings.filter((o) => o.wallId === wallId);
  const across = openings.find((o) => Math.abs(o.at - along) < halfOpening(o));
  if (across) return fail(`The ${across.kind} is in the way. Split beside it.`);
  const cut = { x: wall.a.x + dx * along, y: wall.a.y + dy * along };
  const second: Wall = { ...wall, id: newId(), a: cut, b: { ...wall.b } };
  delete second.pinned;
  const first: Wall = { ...wall, b: cut };
  const next: Plan = {
    ...plan,
    walls: plan.walls.flatMap((w) => (w.id === wallId ? [first, second] : [w])),
    openings: plan.openings.map((o) => (o.wallId === wallId && o.at > along ? { ...o, wallId: second.id, at: o.at - along } : o)),
  };
  return { ok: true, plan: next, summary: `Wall split ${mm(along)} from its start`, id: second.id, created: [{ kind: "wall", id: first.id }, { kind: "wall", id: second.id }] };
}

/** Where the lines through two walls cross, or null when they run parallel. */
export function crossing(a: Pick<Wall, "a" | "b">, b: Pick<Wall, "a" | "b">): Point | null {
  const r = { x: a.b.x - a.a.x, y: a.b.y - a.a.y };
  const s = { x: b.b.x - b.a.x, y: b.b.y - b.a.y };
  const den = r.x * s.y - r.y * s.x;
  if (Math.abs(den) < 1e-6 * Math.hypot(r.x, r.y) * Math.hypot(s.x, s.y)) return null;
  const t = ((b.a.x - a.a.x) * s.y - (b.a.y - a.a.y) * s.x) / den;
  return { x: a.a.x + r.x * t, y: a.a.y + r.y * t };
}

/**
 * Trims or extends two walls so they meet at a corner. Each wall keeps the
 * end further from the corner and moves its nearer end onto it; picking near
 * an end (`keepA`, `keepB`: points on the part to keep) chooses which side of
 * a crossing stays, as Revit does.
 */
export function trimToCorner(plan: Plan, wallA: string, wallB: string, keepA?: Point, keepB?: Point): EditResult {
  if (wallA === wallB) return fail("Pick two different walls.");
  const a = plan.walls.find((w) => w.id === wallA);
  const b = plan.walls.find((w) => w.id === wallB);
  if (!a || !b) return fail("That wall is no longer on the plan.");
  if (a.levelId !== b.levelId) return fail("Pick two walls on the same floor.");
  const corner = crossing(a, b);
  if (!corner) return fail("Those walls run parallel, so they cannot meet at a corner.");
  if (!finite(corner.x, corner.y) || Math.abs(corner.x) > LIMITS.maxCoord || Math.abs(corner.y) > LIMITS.maxCoord) return fail("Those walls meet too far away.");
  const round = { x: Math.round(corner.x), y: Math.round(corner.y) };
  const reshape = (w: Wall, keep?: Point): Wall => {
    // Along the wall from the corner: both ends on one side means it is extended (or cut back) from its nearer end.
    const side = (p: Point) => (p.x - round.x) * (w.b.x - w.a.x) + (p.y - round.y) * (w.b.y - w.a.y);
    const sa = side(w.a);
    const sb = side(w.b);
    const keepEndB = sa * sb >= 0 || !keep ? distance(w.b, round) >= distance(w.a, round) : Math.sign(side(keep)) === Math.sign(sb);
    return keepEndB ? { ...w, a: round } : { ...w, b: round };
  };
  const nextA = reshape(a, keepA);
  const nextB = reshape(b, keepB);
  for (const w of [nextA, nextB]) if (wallLength(w) < LIMITS.minWall) return fail("That would leave a wall too short. Pick the parts to keep.");
  const walls = plan.walls.map((w) => (w.id === wallA ? nextA : w.id === wallB ? nextB : w));
  // A wall whose start moved has its doors and windows measured from the new start.
  const shift = new Map<string, number>();
  for (const [before, after] of [[a, nextA], [b, nextB]] as const) {
    if (before.a.x !== after.a.x || before.a.y !== after.a.y) {
      const len = wallLength(before) || 1;
      const ux = (before.b.x - before.a.x) / len;
      const uy = (before.b.y - before.a.y) / len;
      shift.set(before.id, (after.a.x - before.a.x) * ux + (after.a.y - before.a.y) * uy);
    }
  }
  const next: Plan = { ...plan, walls, openings: plan.openings.map((o) => (shift.has(o.wallId) ? { ...o, at: o.at - shift.get(o.wallId)! } : o)) };
  for (const w of [nextA, nextB]) {
    const problem = openingsFit(next, w.id, wallLength(w));
    if (problem) return fail(problem);
    if (next.openings.some((o) => o.wallId === w.id && o.at - halfOpening(o) < 0)) return fail("A door or window would be cut off. Move it first.");
  }
  return { ok: true, plan: next, summary: `Walls meet at a corner (${Math.round(round.x)}, ${Math.round(round.y)})`, created: [{ kind: "wall", id: wallA }, { kind: "wall", id: wallB }] };
}

/** A copy of a wall, `by` mm to its left (going from its start to its end); negative goes right. */
export function offsetWall(plan: Plan, wallId: string, by: number): EditResult {
  const wall = plan.walls.find((w) => w.id === wallId);
  if (!wall) return fail("That wall is no longer on the plan.");
  if (!finite(by) || Math.abs(by) < 1) return fail("Offset it by at least 1 mm.");
  if (Math.abs(by) > LIMITS.maxWall) return fail("That is further than 300 m.");
  const len = wallLength(wall) || 1;
  const nx = (-(wall.b.y - wall.a.y) / len) * by;
  const ny = ((wall.b.x - wall.a.x) / len) * by;
  const copy: Wall = { ...wall, id: newId(), a: { x: Math.round(wall.a.x + nx), y: Math.round(wall.a.y + ny) }, b: { x: Math.round(wall.b.x + nx), y: Math.round(wall.b.y + ny) } };
  delete copy.pinned;
  return { ok: true, plan: { ...plan, walls: [...plan.walls, copy] }, summary: `Wall offset ${mm(Math.abs(by))}`, id: copy.id, created: [{ kind: "wall", id: copy.id }] };
}
