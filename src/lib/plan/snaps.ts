import { distance, type Plan, type Point, type Wall } from "./geometry";
import { draftBounds, segmentsOf, snapPointsOf, styleOf, type Segment } from "./drafting";
import { crossings } from "./draft-modify";

/**
 * Object snaps, as in Revit and AutoCAD: a click near a corner, the middle of
 * a wall, the centre of a column or a point along a wall lands exactly on it.
 * Within reach, corners win over middles, middles over centres, and centres
 * over a plain point on a wall; between two of a kind the nearer wins.
 */

export type SnapKind = "corner" | "end" | "intersection" | "middle" | "perpendicular" | "tangent" | "centre" | "quadrant" | "wall";

export interface Snap {
  point: Point;
  kind: SnapKind;
  /** The wall a "wall" or "middle" snap is on. */
  wallId?: string;
}

export const SNAP_LABEL: Record<SnapKind, string> = {
  corner: "Corner",
  end: "Endpoint",
  intersection: "Intersection",
  middle: "Middle",
  perpendicular: "Perpendicular",
  tangent: "Tangent",
  quadrant: "Quadrant",
  centre: "Centre",
  wall: "On wall",
};

const RANK: Record<SnapKind, number> = { corner: 0, end: 0, intersection: 0, middle: 1, perpendicular: 1, tangent: 1, centre: 2, quadrant: 2, wall: 3 };

/** At most this many lines near the pointer are crossed with each other, to keep snapping quick. */
const MAX_NEAR = 80;

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
 * itself. `from` is the last point of a line being drawn, for perpendicular
 * and tangent snaps.
 */
export function snapPoint(level: Plan, p: Point, within: number, extra: Point[] = [], skip?: string, from?: Point): Snap | null {
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
  // Where drawn lines cross each other or a wall's centre line, and perpendicular and tangent to them from the last point.
  const near = nearSegments(level, p, within, skip);
  for (let i = 0; i < near.length; i++) for (let j = i + 1; j < near.length; j++) for (const x of crossings(near[i], near[j])) consider(x.p, "intersection");
  if (from) {
    for (const s of near) {
      const foot = perpendicularFoot(s, from);
      if (foot) consider(foot, "perpendicular");
      if (s.t === "arc") for (const t of tangentPoints(s, from)) consider(t, "tangent");
    }
  }
  if (!best)
    for (const w of level.walls) {
      if (w.id === skip) continue;
      const on = nearestOnWall(w, p);
      if (on.t > 0 && on.t < 1) consider({ x: Math.round(on.point.x), y: Math.round(on.point.y) }, "wall", w.id);
    }
  return best;
}

/** Drawn lines and arcs, and wall centre lines, that pass within reach of p. */
function nearSegments(level: Plan, p: Point, within: number, skip?: string): Segment[] {
  const out: Segment[] = [];
  const close = (b: { minX: number; minY: number; maxX: number; maxY: number }) => p.x >= b.minX - within && p.x <= b.maxX + within && p.y >= b.minY - within && p.y <= b.maxY + within;
  for (const d of level.drafts ?? []) {
    if (d.shape === "text" || styleOf(level, d).hidden || !close(draftBounds(d))) continue;
    for (const s of segmentsOf(d)) {
      if (out.length >= MAX_NEAR) return out;
      if (s.t === "line" ? close({ minX: Math.min(s.a.x, s.b.x), minY: Math.min(s.a.y, s.b.y), maxX: Math.max(s.a.x, s.b.x), maxY: Math.max(s.a.y, s.b.y) }) : Math.abs(distance(p, s.c) - s.r) <= within) out.push(s);
    }
  }
  for (const w of level.walls) {
    if (w.id === skip || out.length >= MAX_NEAR) continue;
    if (close({ minX: Math.min(w.a.x, w.b.x), minY: Math.min(w.a.y, w.b.y), maxX: Math.max(w.a.x, w.b.x), maxY: Math.max(w.a.y, w.b.y) })) out.push({ t: "line", a: w.a, b: w.b });
  }
  return out;
}

/** The foot of the perpendicular from `from` to a line, or the point on an arc in line with its centre; null when off the shape. */
function perpendicularFoot(s: Segment, from: Point): Point | null {
  if (s.t === "line") {
    const v = { x: s.b.x - s.a.x, y: s.b.y - s.a.y };
    const len2 = v.x * v.x + v.y * v.y;
    if (len2 < 1e-9) return null;
    const t = ((from.x - s.a.x) * v.x + (from.y - s.a.y) * v.y) / len2;
    if (t < 0 || t > 1) return null;
    const foot = { x: s.a.x + v.x * t, y: s.a.y + v.y * t };
    return distance(foot, from) < 1 ? null : foot;
  }
  const d = distance(from, s.c);
  if (d < 1e-6) return null;
  const a = Math.atan2(from.y - s.c.y, from.x - s.c.x);
  for (const ang of [a, a + Math.PI]) if (onArc(s, ang)) return { x: s.c.x + s.r * Math.cos(ang), y: s.c.y + s.r * Math.sin(ang) };
  return null;
}

/** The points on an arc where a line from `from` touches it. */
function tangentPoints(s: Extract<Segment, { t: "arc" }>, from: Point): Point[] {
  const d = distance(from, s.c);
  if (d <= s.r + 1e-6) return [];
  const base = Math.atan2(from.y - s.c.y, from.x - s.c.x);
  const spread = Math.acos(s.r / d);
  return [base + spread, base - spread].filter((a) => onArc(s, a)).map((a) => ({ x: s.c.x + s.r * Math.cos(a), y: s.c.y + s.r * Math.sin(a) }));
}

function onArc(s: Extract<Segment, { t: "arc" }>, a: number): boolean {
  const TAU = Math.PI * 2;
  if (Math.abs(s.sweep) >= TAU - 1e-9) return true;
  const d = s.sweep >= 0 ? (((a - s.a0) % TAU) + TAU) % TAU : (((s.a0 - a) % TAU) + TAU) % TAU;
  return d <= Math.abs(s.sweep) + 1e-9;
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
