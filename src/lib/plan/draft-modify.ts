import { distance, mm, newId, type EditResult, type Plan, type Point } from "./geometry";
import { addDraft, arcThrough, describeDraft, draftName, drafts, draftProblem, segmentsOf, styleOf, type Draft, type Segment } from "./drafting";

/**
 * AutoCAD's Modify tools for drawn shapes: offset, trim, extend, fillet,
 * chamfer, break, join and explode. Each works on the shapes' lines and arcs
 * and returns an edit like every other, so the assistant can make the same
 * edits a person makes. Trim and extend stop at other drawn shapes and at
 * the faces of walls on the same floor.
 */

type Arc = Extract<Segment, { t: "arc" }>;
type Shape = Omit<Draft, "id">;

const TAU = Math.PI * 2;
const EPS = 1e-6;
const fail = (error: string): EditResult => ({ ok: false, error });
const r1 = (v: number) => Math.round(v * 10) / 10;
const ccw = (a: number) => ((a % TAU) + TAU) % TAU;
const deg = (rad: number) => (rad * 180) / Math.PI;
const norm360 = (a: number) => r1(((a % 360) + 360) % 360);
const at = (c: Point, r: number, a: number): Point => ({ x: c.x + r * Math.cos(a), y: c.y + r * Math.sin(a) });
const sub = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y });
const add = (a: Point, b: Point): Point => ({ x: a.x + b.x, y: a.y + b.y });
const mul = (a: Point, k: number): Point => ({ x: a.x * k, y: a.y * k });
const dot = (a: Point, b: Point) => a.x * b.x + a.y * b.y;
const cross = (a: Point, b: Point) => a.x * b.y - a.y * b.x;
const unit = (a: Point): Point => {
  const l = Math.hypot(a.x, a.y) || 1;
  return { x: a.x / l, y: a.y / l };
};

const STYLE_KEYS = ["layer", "color", "linetype", "weight"] as const;
function styleFrom(d: Draft): Pick<Draft, "layer" | "color" | "linetype" | "weight"> {
  const out: Pick<Draft, "layer" | "color" | "linetype" | "weight"> = {};
  for (const k of STYLE_KEYS) if (d[k] != null) (out as Record<string, unknown>)[k] = d[k];
  return out;
}

// ---------------------------------------------------------------------------
// Segments
// ---------------------------------------------------------------------------

export function segStart(s: Segment): Point {
  return s.t === "line" ? s.a : at(s.c, s.r, s.a0);
}

export function segEnd(s: Segment): Point {
  return s.t === "line" ? s.b : at(s.c, s.r, s.a0 + s.sweep);
}

function segLength(s: Segment): number {
  return s.t === "line" ? distance(s.a, s.b) : Math.abs(s.sweep) * s.r;
}

function reverse(s: Segment): Segment {
  return s.t === "line" ? { t: "line", a: s.b, b: s.a } : { ...s, a0: s.a0 + s.sweep, sweep: -s.sweep };
}

/** Where along an arc a point at angle `a` sits, as a fraction of its sweep (may be over 1). */
function arcParam(s: Arc, a: number): number {
  const d = s.sweep >= 0 ? ccw(a - s.a0) : ccw(s.a0 - a);
  return d / Math.abs(s.sweep);
}

/** The part of a segment between fractions t0 and t1. */
function cut(s: Segment, t0: number, t1: number): Segment {
  if (s.t === "line") return { t: "line", a: add(s.a, mul(sub(s.b, s.a), t0)), b: add(s.a, mul(sub(s.b, s.a), t1)) };
  return { ...s, a0: s.a0 + s.sweep * t0, sweep: s.sweep * (t1 - t0) };
}

/** The point at fraction t along a segment. */
function pointOn(s: Segment, t: number): Point {
  return s.t === "line" ? add(s.a, mul(sub(s.b, s.a), t)) : at(s.c, s.r, s.a0 + s.sweep * t);
}

/** The fraction along a segment nearest a point, kept within 0..1. */
function nearestParam(s: Segment, p: Point): number {
  if (s.t === "line") {
    const v = sub(s.b, s.a);
    return Math.max(0, Math.min(1, dot(sub(p, s.a), v) / (dot(v, v) || 1)));
  }
  const t = arcParam(s, Math.atan2(p.y - s.c.y, p.x - s.c.x));
  if (t <= 1) return t;
  // Past the end: whichever end is nearer round the circle.
  const full = TAU / Math.abs(s.sweep);
  return t - 1 < full - t ? 1 : 0;
}

/**
 * Where two segments cross, as fractions along each. With `unbounded` the
 * first segment runs on for ever: a line both ways, an arc round its circle.
 */
export function crossings(s: Segment, o: Segment, unbounded = false): { p: Point; t: number; u: number }[] {
  const out: { p: Point; t: number; u: number }[] = [];
  const onS = (t: number) => unbounded || (t >= -EPS && t <= 1 + EPS);
  const onO = (u: number) => u >= -EPS && u <= 1 + EPS;
  const paramOf = (seg: Segment, p: Point, free: boolean): number => {
    if (seg.t === "line") {
      const v = sub(seg.b, seg.a);
      return dot(sub(p, seg.a), v) / (dot(v, v) || 1);
    }
    const t = arcParam(seg, Math.atan2(p.y - seg.c.y, p.x - seg.c.x));
    // A point just before an arc's start reads as nearly a full turn on.
    if (!free && t > 1 && Math.abs(t * Math.abs(seg.sweep) - TAU) * seg.r < 1e-3) return 0;
    return t;
  };
  let points: Point[] = [];
  if (s.t === "line" && o.t === "line") {
    const r = sub(s.b, s.a);
    const q = sub(o.b, o.a);
    const den = cross(r, q);
    if (Math.abs(den) < 1e-12) return out;
    const t = cross(sub(o.a, s.a), q) / den;
    const u = cross(sub(o.a, s.a), r) / den;
    if (onS(t) && onO(u)) out.push({ p: add(s.a, mul(r, t)), t, u });
    return out;
  }
  if (s.t === "line" || o.t === "line") {
    const line = (s.t === "line" ? s : o) as Extract<Segment, { t: "line" }>;
    const arc = (s.t === "arc" ? s : o) as Arc;
    const d = sub(line.b, line.a);
    const f = sub(line.a, arc.c);
    const A = dot(d, d);
    const B = 2 * dot(f, d);
    const C = dot(f, f) - arc.r * arc.r;
    const disc = B * B - 4 * A * C;
    if (disc < 0 || A < 1e-12) return out;
    const sq = Math.sqrt(disc);
    const ts = disc < 1e-9 ? [-B / (2 * A)] : [(-B - sq) / (2 * A), (-B + sq) / (2 * A)];
    points = ts.map((t) => add(line.a, mul(d, t)));
  } else {
    const a = s as Arc;
    const b = o as Arc;
    const dd = distance(a.c, b.c);
    if (dd < 1e-9 || dd > a.r + b.r + 1e-9 || dd < Math.abs(a.r - b.r) - 1e-9) return out;
    const x = (dd * dd + a.r * a.r - b.r * b.r) / (2 * dd);
    const h = Math.sqrt(Math.max(0, a.r * a.r - x * x));
    const u = unit(sub(b.c, a.c));
    const m = add(a.c, mul(u, x));
    points = h < 1e-9 ? [m] : [add(m, { x: -u.y * h, y: u.x * h }), add(m, { x: u.y * h, y: -u.x * h })];
  }
  for (const p of points) {
    const t = paramOf(s, p, unbounded);
    const u = paramOf(o, p, false);
    if (onS(t) && onO(u)) out.push({ p, t, u });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Paths: a shape as segments with one parameter, T = segment index + fraction
// ---------------------------------------------------------------------------

function pathOf(d: Draft): Segment[] | null {
  if (d.shape === "text" || d.shape === "ellipse" || d.shape === "leader") return null;
  return segmentsOf(d);
}

const closedPath = (d: Draft) => d.shape === "circle" || (d.shape === "polyline" && !!d.closed);

/** The segments from T0 to T1 (T0 < T1); a closed path may run past its end and round again. */
function subPath(segs: Segment[], t0: number, t1: number, wrap: boolean): Segment[] {
  const n = segs.length;
  const out: Segment[] = [];
  for (let i = Math.floor(t0); i < Math.ceil(t1) && i < (wrap ? 2 * n : n); i++) {
    const s = segs[((i % n) + n) % n];
    const a = Math.max(t0 - i, 0);
    const b = Math.min(t1 - i, 1);
    if (b - a < 1e-9) continue;
    const piece = cut(s, a, b);
    if (segLength(piece) > 0.05) out.push(piece);
  }
  return out;
}

/** The parameter of the point on a path nearest p. */
function nearestOnPath(segs: Segment[], p: Point): { T: number; off: number } {
  let best = { T: 0, off: Infinity };
  segs.forEach((s, i) => {
    const t = nearestParam(s, p);
    const off = distance(pointOn(s, t), p);
    if (off < best.off) best = { T: i + t, off };
  });
  return best;
}

/** A shape built from segments in the style of `like`: a line, an arc or a polyline. */
export function shapeFrom(segs: Segment[], like: Draft, closed = false): Shape | null {
  if (!segs.length) return null;
  const base = { levelId: like.levelId, ...styleFrom(like) };
  const keepPolyline = like.shape === "polyline" || segs.length > 1 || closed;
  if (!keepPolyline && segs[0].t === "line") return { ...base, shape: "line", points: [segs[0].a, segs[0].b] };
  if (!keepPolyline && segs[0].t === "arc") {
    const s = segs[0];
    const [a, b] = s.sweep >= 0 ? [s.a0, s.a0 + s.sweep] : [s.a0 + s.sweep, s.a0];
    return { ...base, shape: "arc", points: [s.c], radius: r1(s.r), start: norm360(deg(a)), end: norm360(deg(b)) };
  }
  const points = [segStart(segs[0]), ...segs.map(segEnd)];
  const bulges = segs.map((s) => (s.t === "arc" ? Math.tan(s.sweep / 4) : 0));
  if (closed) points.pop();
  const shape: Shape = { ...base, shape: "polyline", points, ...(closed ? { closed: true } : {}) };
  if (bulges.some((b) => Math.abs(b) > 1e-9)) shape.bulges = bulges.map((b) => Math.round(b * 1e6) / 1e6);
  if (closed && like.fill) shape.fill = like.fill;
  return shape;
}

/** Swaps a shape for zero or more new ones, the first keeping its id. */
function replace(plan: Plan, d: Draft, shapes: Shape[], summary: string): EditResult {
  const list = drafts(plan);
  const made: Draft[] = shapes.map((s, i) => ({ ...s, id: i === 0 ? d.id : newId() }));
  for (const m of made) {
    if (m.points) m.points = m.points.map((p) => ({ x: r1(p.x), y: r1(p.y) }));
    const problem = draftProblem(plan, m);
    if (problem) return fail(problem);
  }
  const at = list.findIndex((x) => x.id === d.id);
  const next = [...list.slice(0, at), ...made, ...list.slice(at + 1)];
  return { ok: true, plan: { ...plan, drafts: next }, summary, id: made[0]?.id, created: made.slice(1).map((m) => ({ kind: "draft" as const, id: m.id })) };
}

/** What trim and extend stop at: other shapes' lines and the faces of walls on the floor. */
function edgesFor(plan: Plan, d: Draft): Segment[] {
  const out: Segment[] = [];
  for (const o of drafts(plan)) {
    if (o.id === d.id || o.levelId !== d.levelId || o.shape === "text" || styleOf(plan, o).hidden) continue;
    out.push(...segmentsOf(o));
  }
  for (const w of plan.walls) {
    if (w.levelId !== d.levelId) continue;
    const n = mul(unit({ x: -(w.b.y - w.a.y), y: w.b.x - w.a.x }), w.thickness / 2);
    out.push({ t: "line", a: add(w.a, n), b: add(w.b, n) }, { t: "line", a: sub(w.a, n), b: sub(w.b, n) });
  }
  return out;
}

function find(plan: Plan, id: string): Draft | undefined {
  return drafts(plan).find((x) => x.id === id);
}

// ---------------------------------------------------------------------------
// Trim and break
// ---------------------------------------------------------------------------

/**
 * Trims away the part of a shape around `pick`, between the nearest crossings
 * with other shapes or wall faces either side of it. A circle or a closed
 * polyline needs two crossings and opens up.
 */
export function trimDraft(plan: Plan, id: string, pick: Point): EditResult {
  const d = find(plan, id);
  if (!d) return fail("That shape is no longer on the plan.");
  const segs = pathOf(d);
  if (!segs?.length) return fail("Trim works on lines, polylines, arcs and circles.");
  const n = segs.length;
  const edges = edgesFor(plan, d);
  const ts: number[] = [];
  segs.forEach((s, i) => {
    for (const e of edges) for (const x of crossings(s, e)) ts.push(i + Math.max(0, Math.min(1, x.t)));
  });
  const P = nearestOnPath(segs, pick).T;
  const closed = closedPath(d);
  const ends = (T: number) => !closed && (T < 1e-4 || T > n - 1e-4);
  const cuts = [...new Set(ts.map((t) => Math.round(t * 1e6) / 1e6))].filter((t) => !ends(t)).sort((a, b) => a - b);
  if (!closed) {
    const lo = Math.max(0, ...cuts.filter((t) => t < P));
    const hi = Math.min(n, ...cuts.filter((t) => t > P));
    if (lo === 0 && hi === n) return fail("Nothing crosses that part, so there is nothing to trim it back to. Remove it instead.");
    const pieces = [subPath(segs, 0, lo, false), subPath(segs, hi, n, false)].filter((p) => p.length).map((p) => shapeFrom(p, d)!);
    if (!pieces.length) return fail("That would trim the whole shape away. Remove it instead.");
    return replace(plan, d, pieces, `${draftName(d)} trimmed`);
  }
  const ring = [...new Set(cuts.map((t) => ((t % n) + n) % n))].sort((a, b) => a - b);
  if (ring.length < 2) return fail(`A ${draftName(d).toLowerCase()} needs two crossings to trim between.`);
  const before = ring.filter((t) => t < P);
  const after = ring.filter((t) => t > P);
  const lo = before.length ? before[before.length - 1] : ring[ring.length - 1] - n;
  const hi = after.length ? after[0] : ring[0] + n;
  // What stays runs from hi round to lo.
  const keep = subPath(segs, hi, lo + n, true);
  const like: Draft = d.shape === "circle" ? { ...d, shape: "arc" } : d;
  const shape = shapeFrom(keep, like);
  if (!shape) return fail("That would trim the whole shape away. Remove it instead.");
  return replace(plan, d, [shape], `${draftName(d)} trimmed`);
}

/**
 * Breaks a shape at a point, or takes out the part between two points. A
 * closed shape broken at one point opens there; between two, the part from
 * the first round to the second (anticlockwise on a circle) goes.
 */
export function breakDraft(plan: Plan, id: string, a: Point, b?: Point): EditResult {
  const d = find(plan, id);
  if (!d) return fail("That shape is no longer on the plan.");
  const segs = pathOf(d);
  if (!segs?.length) return fail("Break works on lines, polylines, arcs and circles.");
  const n = segs.length;
  const A = nearestOnPath(segs, a).T;
  const closed = closedPath(d);
  if (!closed) {
    if (!b) {
      if (A < 1e-4 || A > n - 1e-4) return fail("Pick a point along the shape, not at its end.");
      const pieces = [subPath(segs, 0, A, false), subPath(segs, A, n, false)].map((p) => shapeFrom(p, d)!);
      return replace(plan, d, pieces, `${draftName(d)} broken in two`);
    }
    const B = nearestOnPath(segs, b).T;
    const [lo, hi] = A < B ? [A, B] : [B, A];
    const pieces = [subPath(segs, 0, lo, false), subPath(segs, hi, n, false)].filter((p) => p.length).map((p) => shapeFrom(p, d)!);
    if (!pieces.length) return fail("That would take the whole shape away. Remove it instead.");
    return replace(plan, d, pieces, `${mm(segLengthSum(subPath(segs, lo, hi, false)))} taken out of the ${draftName(d).toLowerCase()}`);
  }
  const like: Draft = d.shape === "circle" ? { ...d, shape: "arc" } : d;
  if (!b) {
    if (d.shape === "circle") return fail("A circle needs two points to break between.");
    const shape = shapeFrom(subPath(segs, A, A + n, true), like);
    return shape ? replace(plan, d, [shape], `${draftName(d)} opened`) : fail("That point is not on the shape.");
  }
  const B = nearestOnPath(segs, b).T;
  const end = B > A ? B : B + n;
  const shape = shapeFrom(subPath(segs, end, A + n, true), like);
  return shape ? replace(plan, d, [shape], `${draftName(d)} broken open`) : fail("That would take the whole shape away. Remove it instead.");
}

function segLengthSum(segs: Segment[]): number {
  return segs.reduce((s, g) => s + segLength(g), 0);
}

// ---------------------------------------------------------------------------
// Extend
// ---------------------------------------------------------------------------

/** Runs the end of a line, arc or open polyline nearest `pick` on to the next shape or wall face it meets. */
export function extendDraft(plan: Plan, id: string, pick: Point): EditResult {
  const d = find(plan, id);
  if (!d) return fail("That shape is no longer on the plan.");
  const segs = pathOf(d);
  if (!segs?.length || closedPath(d)) return fail("Extend works on lines, arcs and open polylines.");
  const atEnd = distance(pick, segEnd(segs[segs.length - 1])) <= distance(pick, segStart(segs[0]));
  const idx = atEnd ? segs.length - 1 : 0;
  // Work on the end segment running towards the end being extended.
  const s = atEnd ? segs[idx] : reverse(segs[idx]);
  let best: number | null = null;
  for (const e of edgesFor(plan, d)) {
    for (const x of crossings(s, e, true)) {
      if (s.t === "line") {
        if (x.t > 1 + 1e-6 && (best == null || x.t < best)) best = x.t;
      } else {
        // Round the circle beyond the end, short of coming back to the start.
        const extra = x.t * Math.abs(s.sweep) - Math.abs(s.sweep);
        if (extra > 1e-6 && extra < TAU - Math.abs(s.sweep) - 1e-6 && (best == null || extra < best)) best = extra;
      }
    }
  }
  if (best == null) return fail("Nothing lies ahead of that end to extend it to.");
  const longer: Segment = s.t === "line" ? { t: "line", a: s.a, b: pointOn(s, best) } : { ...s, sweep: s.sweep + Math.sign(s.sweep) * best };
  const next = [...segs];
  next[idx] = atEnd ? longer : reverse(longer);
  const shape = shapeFrom(next, d);
  const grew = segLength(longer) - segLength(s);
  return replace(plan, d, [shape!], `${draftName(d)} extended ${mm(grew)}`);
}

// ---------------------------------------------------------------------------
// Offset
// ---------------------------------------------------------------------------

/** Which side of a shape a point is: +1 on its left (inside an anticlockwise arc), -1 on its right. */
function sideOf(segs: Segment[], p: Point): number {
  const { T } = nearestOnPath(segs, p);
  const s = segs[Math.min(segs.length - 1, Math.floor(T))];
  if (s.t === "line") return Math.sign(cross(sub(s.b, s.a), sub(p, s.a))) || 1;
  const inside = distance(p, s.c) < s.r;
  return (inside ? 1 : -1) * (s.sweep >= 0 ? 1 : -1);
}

function offsetSegment(s: Segment, k: number): Segment | null {
  if (s.t === "line") {
    const n = mul(unit({ x: -(s.b.y - s.a.y), y: s.b.x - s.a.x }), k);
    return { t: "line", a: add(s.a, n), b: add(s.b, n) };
  }
  const r = s.r - k * Math.sign(s.sweep);
  return r > 0.5 ? { ...s, r } : null;
}

/** Where two lines would meet if they ran on, or null when they are parallel. */
function meet(a: Extract<Segment, { t: "line" }>, b: Extract<Segment, { t: "line" }>): Point | null {
  const r = sub(a.b, a.a);
  const q = sub(b.b, b.a);
  const den = cross(r, q);
  if (Math.abs(den) < 1e-12) return null;
  return add(a.a, mul(r, cross(sub(b.a, a.a), q) / den));
}

/**
 * A copy of a shape `by` mm away on the side `side` lies: a parallel line,
 * a circle or arc with a bigger or smaller radius, a polyline with its
 * corners kept sharp.
 */
export function offsetDraft(plan: Plan, id: string, by: number, side: Point): EditResult {
  const d = find(plan, id);
  if (!d) return fail("That shape is no longer on the plan.");
  if (!(by > 0)) return fail("Type how far to offset, in mm.");
  if (d.shape === "text" || d.shape === "leader") return fail("Offset works on lines, polylines, arcs, circles and ellipses.");
  // An offset copy keeps the shape's style but not its hatch, as in CAD.
  const base: Shape = { ...d };
  delete (base as Partial<Draft>).id;
  delete base.fill;
  if (d.shape === "circle" || d.shape === "arc" || d.shape === "ellipse") {
    const outward = distance(side, d.points[0]) > (d.shape === "ellipse" ? Math.sqrt((d.radius ?? 0) * (d.radius2 ?? 0)) : (d.radius ?? 0));
    const k = outward ? by : -by;
    const radius = (d.radius ?? 0) + k;
    const radius2 = d.shape === "ellipse" ? (d.radius2 ?? 0) + k : undefined;
    if (radius <= 0.5 || (radius2 != null && radius2 <= 0.5)) return fail(`It is too small to offset ${mm(by)} inwards.`);
    return result(addDraft(plan, { ...base, radius: r1(radius), ...(radius2 != null ? { radius2: r1(radius2) } : {}) }), `${draftName(d)} offset ${mm(by)}`);
  }
  const segs = segmentsOf(d);
  const k = sideOf(segs, side) * by;
  const moved = segs.map((s) => offsetSegment(s, k));
  if (moved.some((s) => !s)) return fail(`An arc in it is too tight to offset ${mm(by)} that way.`);
  const out = moved as Segment[];
  const closed = closedPath(d);
  // Lines next to each other meet again where they would cross.
  const joins = closed ? out.length : out.length - 1;
  for (let i = 0; i < joins; i++) {
    const a = out[i];
    const b = out[(i + 1) % out.length];
    if (a.t !== "line" || b.t !== "line") continue;
    const x = meet(a, b);
    if (!x) continue;
    out[i] = { ...a, b: x };
    out[(i + 1) % out.length] = { ...out[(i + 1) % out.length], a: x } as Segment;
  }
  // Where an arc and a line no longer meet, a short straight piece joins them.
  const stitched: Segment[] = [];
  out.forEach((s, i) => {
    stitched.push(s);
    if (i === out.length - 1 && !closed) return;
    const nx = out[(i + 1) % out.length];
    if (distance(segEnd(s), segStart(nx)) > 0.5) stitched.push({ t: "line", a: segEnd(s), b: segStart(nx) });
  });
  const shape = shapeFrom(stitched, base as Draft, closed);
  if (!shape) return fail("That offset leaves nothing to draw.");
  return result(addDraft(plan, shape), `${draftName(d)} offset ${mm(by)}`);
}

function result(r: EditResult, summary: string): EditResult {
  return r.ok ? { ...r, summary } : r;
}

// ---------------------------------------------------------------------------
// Fillet and chamfer
// ---------------------------------------------------------------------------

export type CornerCut = { radius: number } | { chamfer: [number, number] };

/** The two points a fillet or chamfer cuts back to from corner X along u1 and u2, and the bulge between. */
function cornerCut(X: Point, u1: Point, u2: Point, how: CornerCut): { t1: number; t2: number; bulge: number; mid?: Point } | null {
  const cos = Math.max(-1, Math.min(1, dot(u1, u2)));
  const theta = Math.acos(cos);
  if (theta < 1e-3 || Math.PI - theta < 1e-3) return null;
  if ("chamfer" in how) return { t1: how.chamfer[0], t2: how.chamfer[1], bulge: 0 };
  const t = how.radius / Math.tan(theta / 2);
  // Going in along u1 and out along u2, the path turns left when u2 is clockwise of -u1.
  const turn = Math.sign(cross(mul(u1, -1), u2));
  const sweep = (Math.PI - theta) * turn;
  const bis = unit(add(u1, u2));
  const mid = add(X, mul(bis, how.radius / Math.sin(theta / 2) - how.radius));
  return { t1: t, t2: t, bulge: Math.tan(sweep / 4), mid };
}

const cutWords = (how: CornerCut) => ("chamfer" in how ? `chamfered ${mm(how.chamfer[0])}${how.chamfer[1] !== how.chamfer[0] ? ` by ${mm(how.chamfer[1])}` : ""}` : how.radius > 0 ? `filleted at ${mm(how.radius)} radius` : "brought to a sharp corner");

/**
 * Fillets or chamfers two lines where they meet (or would meet), keeping the
 * side of each that was picked. Radius 0 brings them to a sharp corner.
 */
export function filletLines(plan: Plan, aId: string, aPick: Point, bId: string, bPick: Point, how: CornerCut): EditResult {
  const a = find(plan, aId);
  const b = find(plan, bId);
  if (!a || !b) return fail("That shape is no longer on the plan.");
  if (a.id === b.id) return a.shape === "polyline" ? filletCorners(plan, a.id, how, nearestCorner(a, aPick)) : fail("Pick two different lines.");
  if (a.shape !== "line" || b.shape !== "line") return fail("Fillet and chamfer join two lines, or round a polyline's corners.");
  const la = { t: "line" as const, a: a.points[0], b: a.points[1] };
  const lb = { t: "line" as const, a: b.points[0], b: b.points[1] };
  const X = meet(la, lb);
  if (!X) return fail("Those lines are parallel, so they never meet.");
  const keepEnd = (l: typeof la, pick: Point) => {
    const v = unit(sub(l.b, l.a));
    const along = dot(sub(pick, X), v);
    const u = along >= 0 ? v : mul(v, -1);
    const far = Math.max(dot(sub(l.a, X), u), dot(sub(l.b, X), u));
    const end = dot(sub(l.a, X), u) >= dot(sub(l.b, X), u) ? l.a : l.b;
    return { u, far, end };
  };
  const ka = keepEnd(la, aPick);
  const kb = keepEnd(lb, bPick);
  const c = "radius" in how && how.radius === 0 ? { t1: 0, t2: 0, bulge: 0 } : cornerCut(X, ka.u, kb.u, how);
  if (!c) return fail("Those lines run straight on from each other; there is no corner.");
  if (c.t1 > ka.far + 0.5 || c.t2 > kb.far + 0.5) return fail("That is too big for these lines.");
  const T1 = add(X, mul(ka.u, c.t1));
  const T2 = add(X, mul(kb.u, c.t2));
  let next = plan;
  const ra = replace(next, a, [{ ...a, points: [ka.end, T1] }], "");
  if (!ra.ok) return ra;
  next = ra.plan;
  const rb = replace(next, b, [{ ...b, points: [kb.end, T2] }], "");
  if (!rb.ok) return rb;
  next = rb.plan;
  if (distance(T1, T2) < 0.5) return { ok: true, plan: next, summary: `Two lines ${cutWords(how)}` };
  let joint: Shape;
  if ("chamfer" in how) joint = { shape: "line", levelId: a.levelId, points: [T1, T2], ...styleFrom(a) };
  else {
    const arc = arcThrough(T1, c.mid!, T2);
    if (!arc) return fail("That fillet has no size.");
    joint = { shape: "arc", levelId: a.levelId, points: [arc.centre], radius: r1(arc.radius), start: arc.start, end: arc.end, ...styleFrom(a) };
  }
  const added = addDraft(next, joint);
  if (!added.ok) return added;
  return { ...added, summary: `Two lines ${cutWords(how)}` };
}

function nearestCorner(d: Draft, p: Point): number {
  let best = 0;
  d.points.forEach((q, i) => {
    if (distance(q, p) < distance(d.points[best], p)) best = i;
  });
  return best;
}

/**
 * Rounds (or chamfers) a polyline's corners: one corner by index, or every
 * corner between two straight sides when no index is given.
 */
export function filletCorners(plan: Plan, id: string, how: CornerCut, corner?: number): EditResult {
  const d = find(plan, id);
  if (!d) return fail("That shape is no longer on the plan.");
  if (d.shape !== "polyline") return fail("Only a polyline has corners to round.");
  const p = d.points;
  const n = p.length;
  const closed = !!d.closed;
  const bulge = (i: number) => d.bulges?.[i] ?? 0;
  const points: Point[] = [];
  const bulges: number[] = [];
  let done = 0;
  for (let i = 0; i < n; i++) {
    const hasCorner = closed || (i > 0 && i < n - 1);
    const prev = (i - 1 + n) % n;
    const want = corner == null || corner === i;
    let cutHere: ReturnType<typeof cornerCut> = null;
    if (hasCorner && want && Math.abs(bulge(prev)) < 1e-9 && Math.abs(bulge(i)) < 1e-9 && !("radius" in how && how.radius === 0)) {
      const u1 = unit(sub(p[prev], p[i]));
      const u2 = unit(sub(p[(i + 1) % n], p[i]));
      cutHere = cornerCut(p[i], u1, u2, how);
      // Cutting every corner shares each side between its two ends.
      const share = corner == null ? 0.5 : 1;
      if (cutHere && (cutHere.t1 > distance(p[prev], p[i]) * share + 0.5 || cutHere.t2 > distance(p[i], p[(i + 1) % n]) * share + 0.5)) {
        if (corner != null) return fail("That is too big for the sides at this corner.");
        cutHere = null;
      }
      if (cutHere) {
        points.push(add(p[i], mul(u1, cutHere.t1)), add(p[i], mul(u2, cutHere.t2)));
        bulges.push(Math.round(cutHere.bulge * 1e6) / 1e6, bulge(i));
        done++;
        continue;
      }
    }
    points.push(p[i]);
    bulges.push(bulge(i));
  }
  if (!done) return fail(corner == null ? "None of its corners sits between two straight sides with room to round." : "That corner is not between two straight sides.");
  // A first corner cut on a closed polyline moves its start; fine, as the loop is the same.
  const next: Draft = { ...d, points };
  if (bulges.some((b) => Math.abs(b) > 1e-9)) next.bulges = bulges.slice(0, closed ? points.length : points.length - 1);
  else delete next.bulges;
  return replace(plan, d, [next], `${done === 1 ? "A corner" : `${done} corners`} ${cutWords(how)}`);
}

// ---------------------------------------------------------------------------
// Join and explode
// ---------------------------------------------------------------------------

/** Joins lines, arcs and open polylines that meet end to end into one polyline. */
export function joinDrafts(plan: Plan, ids: string[]): EditResult {
  const pieces = ids.map((id) => find(plan, id)).filter((d): d is Draft => !!d && (d.shape === "line" || d.shape === "arc" || (d.shape === "polyline" && !d.closed)));
  if (pieces.length < 2) return fail("Pick two or more lines, arcs or open polylines that meet end to end.");
  const first = pieces[0];
  let chain = segmentsOf(first);
  const used = new Set([first.id]);
  const near = (p: Point, q: Point) => distance(p, q) <= 1;
  let grew = true;
  while (grew) {
    grew = false;
    for (const d of pieces) {
      if (used.has(d.id)) continue;
      const s = segmentsOf(d);
      const head = segStart(chain[0]);
      const tail = segEnd(chain[chain.length - 1]);
      const rev = () => [...s].reverse().map(reverse);
      if (near(tail, segStart(s[0]))) chain = [...chain, ...s];
      else if (near(tail, segEnd(s[s.length - 1]))) chain = [...chain, ...rev()];
      else if (near(head, segEnd(s[s.length - 1]))) chain = [...s, ...chain];
      else if (near(head, segStart(s[0]))) chain = [...rev(), ...chain];
      else continue;
      used.add(d.id);
      grew = true;
    }
  }
  if (used.size < 2) return fail("Those shapes do not meet end to end.");
  const closed = chain.length > 1 && near(segStart(chain[0]), segEnd(chain[chain.length - 1]));
  const shape = shapeFrom(chain, { ...first, shape: "polyline" }, closed);
  if (!shape) return fail("Those shapes do not meet end to end.");
  const left = drafts(plan).filter((x) => x.id === first.id || !used.has(x.id));
  const r = replace({ ...plan, drafts: left }, first, [shape], `${used.size} shapes joined into a ${closed ? "closed " : ""}polyline`);
  return r.ok ? { ...r, created: [{ kind: "draft", id: first.id }] } : r;
}

/** Breaks a polyline into its lines and arcs, or a leader into its lines and words. */
export function explodeDraft(plan: Plan, id: string): EditResult {
  const d = find(plan, id);
  if (!d) return fail("That shape is no longer on the plan.");
  if (d.shape !== "polyline" && d.shape !== "leader") return fail(`A ${draftName(d).toLowerCase()} is already as simple as it gets.`);
  const parts: Shape[] = segmentsOf(d).map((s) => shapeFrom([s], { ...d, shape: s.t === "line" ? "line" : "arc" })!);
  if (d.shape === "leader" && d.text) {
    const end = d.points[d.points.length - 1];
    parts.push({ shape: "text", levelId: d.levelId, points: [end], text: d.text, ...(d.height ? { height: d.height } : {}), ...styleFrom(d) });
  }
  return replace(plan, d, parts, `${describeDraft(d)} exploded into ${parts.length} pieces`);
}
