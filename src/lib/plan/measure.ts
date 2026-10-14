import { pointAlong, pointInPolygon, wallLength, type Plan, type PlanItem, type Point } from "./geometry";

/**
 * Measuring on the plan as a tape would: the clear gap between two things'
 * outlines seen from above (0 when they touch or overlap), the distance
 * between their middles, and the two nearest points the gap runs between.
 */

export type MeasureEnd = PlanItem | Point;

function rect(at: Point, w: number, d: number, rotation: number): Point[] {
  const a = (rotation * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ].map(([sx, sy]) => ({ x: at.x + (sx * w) / 2 * c - (sy * d) / 2 * s, y: at.y + (sx * w) / 2 * s + (sy * d) / 2 * c }));
}

/** A thing's outline from above, in plan mm; a single point for a point. */
export function outlineOf(plan: Plan, end: MeasureEnd): Point[] | null {
  if (!("kind" in end)) return [{ x: end.x, y: end.y }];
  switch (end.kind) {
    case "item": {
      const i = plan.items.find((x) => x.id === end.id);
      return i ? rect(i.at, i.width, i.depth, i.rotation) : null;
    }
    case "wall": {
      const w = plan.walls.find((x) => x.id === end.id);
      if (!w) return null;
      const len = wallLength(w);
      return rect({ x: (w.a.x + w.b.x) / 2, y: (w.a.y + w.b.y) / 2 }, len, w.thickness, (Math.atan2(w.b.y - w.a.y, w.b.x - w.a.x) * 180) / Math.PI);
    }
    case "opening": {
      const o = plan.openings.find((x) => x.id === end.id);
      const w = o && plan.walls.find((x) => x.id === o.wallId);
      if (!o || !w) return null;
      return rect(pointAlong(w, o.at), o.width, w.thickness, (Math.atan2(w.b.y - w.a.y, w.b.x - w.a.x) * 180) / Math.PI);
    }
    case "column": {
      const c = plan.columns.find((x) => x.id === end.id);
      return c ? rect(c.at, c.width, c.round ? c.width : c.depth, 0) : null;
    }
    case "room": {
      const r = plan.rooms.find((x) => x.id === end.id);
      return r ? r.points.map((p) => ({ ...p })) : null;
    }
    case "note": {
      const n = plan.notes.find((x) => x.id === end.id);
      return n ? [{ ...n.at }] : null;
    }
    default:
      return null;
  }
}

function nearestOnSegment(p: Point, a: Point, b: Point): Point {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
  return { x: a.x + dx * t, y: a.y + dy * t };
}

function crosses(a: Point, b: Point, c: Point, d: Point): Point | null {
  const r = { x: b.x - a.x, y: b.y - a.y };
  const s = { x: d.x - c.x, y: d.y - c.y };
  const den = r.x * s.y - r.y * s.x;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((c.x - a.x) * s.y - (c.y - a.y) * s.x) / den;
  const u = ((c.x - a.x) * r.y - (c.y - a.y) * r.x) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? { x: a.x + r.x * t, y: a.y + r.y * t } : null;
}

const edges = (poly: Point[]): [Point, Point][] => (poly.length === 1 ? [[poly[0], poly[0]]] : poly.map((p, i) => [p, poly[(i + 1) % poly.length]]));
const middle = (poly: Point[]) => ({ x: poly.reduce((s, p) => s + p.x, 0) / poly.length, y: poly.reduce((s, p) => s + p.y, 0) / poly.length });

/** The clear gap between two outlines (0 when they touch or one is inside the other) and where it runs. */
export function gapBetween(a: Point[], b: Point[]): { gap: number; from: Point; to: Point } {
  if (a.length > 2 && b.some((p) => pointInPolygon(p, a))) {
    const p = b.find((q) => pointInPolygon(q, a))!;
    return { gap: 0, from: p, to: p };
  }
  if (b.length > 2 && a.some((p) => pointInPolygon(p, b))) {
    const p = a.find((q) => pointInPolygon(q, b))!;
    return { gap: 0, from: p, to: p };
  }
  let best = { gap: Infinity, from: a[0], to: b[0] };
  for (const [p, q] of edges(a))
    for (const [r, s] of edges(b)) {
      const hit = crosses(p, q, r, s);
      if (hit) return { gap: 0, from: hit, to: hit };
      for (const [pt, [u, v], flip] of [
        [p, [r, s], false],
        [q, [r, s], false],
        [r, [p, q], true],
        [s, [p, q], true],
      ] as [Point, [Point, Point], boolean][]) {
        const on = nearestOnSegment(pt, u, v);
        const d = Math.hypot(pt.x - on.x, pt.y - on.y);
        if (d < best.gap) best = flip ? { gap: d, from: on, to: pt } : { gap: d, from: pt, to: on };
      }
    }
  return best;
}

export interface Measurement {
  gap: number;
  centres: number;
  dx: number;
  dy: number;
  from: Point;
  to: Point;
}

export function measure(plan: Plan, a: MeasureEnd, b: MeasureEnd): Measurement | string {
  const pa = outlineOf(plan, a);
  const pb = outlineOf(plan, b);
  if (!pa) return `There is no ${"kind" in a ? `${a.kind} ${a.id}` : "such point"} on the plan.`;
  if (!pb) return `There is no ${"kind" in b ? `${b.kind} ${b.id}` : "such point"} on the plan.`;
  const g = gapBetween(pa, pb);
  const ca = middle(pa);
  const cb = middle(pb);
  const r1 = (v: number) => Math.round(v * 10) / 10;
  return { gap: r1(g.gap), centres: r1(Math.hypot(cb.x - ca.x, cb.y - ca.y)), dx: r1(cb.x - ca.x), dy: r1(cb.y - ca.y), from: { x: r1(g.from.x), y: r1(g.from.y) }, to: { x: r1(g.to.x), y: r1(g.to.y) } };
}
