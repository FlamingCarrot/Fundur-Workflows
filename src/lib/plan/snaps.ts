import { distance, type Plan, type Point, type Wall } from "./geometry";
import { snapPointsOf, styleOf } from "./drafting";

/**
 * Object snaps, as in Revit and AutoCAD: a click near a corner, the middle of
 * a wall, the centre of a column or a point along a wall lands exactly on it.
 * Within reach, corners win over middles, middles over centres, and centres
 * over a plain point on a wall; between two of a kind the nearer wins.
 */

export type SnapKind = "corner" | "end" | "middle" | "centre" | "quadrant" | "wall";

export interface Snap {
  point: Point;
  kind: SnapKind;
  /** The wall a "wall" or "middle" snap is on. */
  wallId?: string;
}

export const SNAP_LABEL: Record<SnapKind, string> = {
  corner: "Corner",
  end: "Endpoint",
  middle: "Middle",
  quadrant: "Quadrant",
  centre: "Centre",
  wall: "On wall",
};

const RANK: Record<SnapKind, number> = { corner: 0, end: 0, middle: 1, centre: 2, quadrant: 2, wall: 3 };

/** The nearest point on a wall's centre line, and how far along it is (0 to 1). */
export function nearestOnWall(wall: Pick<Wall, "a" | "b">, p: Point): { point: Point; t: number } {
  const dx = wall.b.x - wall.a.x;
  const dy = wall.b.y - wall.a.y;
  const len2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((p.x - wall.a.x) * dx + (p.y - wall.a.y) * dy) / len2));
  return { point: { x: wall.a.x + dx * t, y: wall.a.y + dy * t }, t };
}

/**
 * The snap for a point on one floor (`level` holds only that floor), or null.
 * `within` is the reach in mm; `extra` are points of the shape being drawn,
 * which count as corners; `skip` is a wall being moved, which cannot snap to
 * itself.
 */
export function snapPoint(level: Plan, p: Point, within: number, extra: Point[] = [], skip?: string): Snap | null {
  let best: Snap | null = null;
  let bestD = Infinity;
  const consider = (point: Point, kind: SnapKind, wallId?: string) => {
    const d = distance(p, point);
    if (d > within) return;
    const current = best as Snap | null;
    if (!current || RANK[kind] < RANK[current.kind] || (RANK[kind] === RANK[current.kind] && d < bestD)) {
      best = { point, kind, ...(wallId ? { wallId } : {}) };
      bestD = d;
    }
  };
  for (const w of level.walls) {
    if (w.id === skip) continue;
    consider(w.a, "corner");
    consider(w.b, "corner");
  }
  for (const r of level.rooms) for (const q of r.points) consider(q, "corner");
  for (const q of extra) consider(q, "corner");
  for (const w of level.walls) {
    if (w.id === skip) continue;
    consider({ x: (w.a.x + w.b.x) / 2, y: (w.a.y + w.b.y) / 2 }, "middle", w.id);
  }
  for (const c of level.columns) consider(c.at, "centre");
  // Drawn shapes on visible, unlocked layers: their ends, middles, centres and quadrants.
  for (const d of level.drafts ?? []) {
    const st = styleOf(level, d);
    if (st.hidden) continue;
    for (const q of snapPointsOf(d)) consider(q.point, q.kind === "node" ? "end" : q.kind);
  }
  if (!best)
    for (const w of level.walls) {
      if (w.id === skip) continue;
      const on = nearestOnWall(w, p);
      if (on.t > 0 && on.t < 1) consider({ x: Math.round(on.point.x), y: Math.round(on.point.y) }, "wall", w.id);
    }
  return best;
}

/**
 * Where a wall drawn from `from` towards `towards` (already squared up) meets
 * a wall near the pointer, so a partition can end exactly on a wall it runs
 * into. Null when no wall crosses its line close by.
 */
export function meetWall(level: Plan, from: Point, towards: Point, within: number): Snap | null {
  const dx = towards.x - from.x;
  const dy = towards.y - from.y;
  if (Math.hypot(dx, dy) < 1) return null;
  let best: Snap | null = null;
  let bestD = within;
  for (const w of level.walls) {
    const ex = w.b.x - w.a.x;
    const ey = w.b.y - w.a.y;
    const den = dx * ey - dy * ex;
    if (Math.abs(den) < 1e-9) continue;
    // from + s·d = a + u·e
    const s = ((w.a.x - from.x) * ey - (w.a.y - from.y) * ex) / den;
    const u = ((w.a.x - from.x) * dy - (w.a.y - from.y) * dx) / den;
    if (s <= 0 || u < 0 || u > 1) continue;
    const point = { x: from.x + dx * s, y: from.y + dy * s };
    const d = distance(point, towards);
    if (d <= bestD) {
      best = { point: { x: Math.round(point.x), y: Math.round(point.y) }, kind: "wall", wallId: w.id };
      bestD = d;
    }
  }
  return best;
}
