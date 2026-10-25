import { distance, finite, LIMITS, mm, newId, type EditResult, type Plan, type Point } from "./geometry";

/**
 * Drafting on the plan, as in AutoCAD: lines, polylines (with arc segments),
 * circles, arcs, ellipses, text and leaders, each on a drawing layer with a
 * colour, line type and weight, and closed shapes optionally hatched. They are
 * for what walls and furniture do not cover: joinery setting out, ceiling
 * lines, floor patterns, details and notes with arrows. Millimetres, y up.
 *
 * Rectangles and polygons are closed polylines; a hatch is a fill on any
 * closed shape.
 */

export const DRAFT_SHAPES = ["line", "polyline", "circle", "arc", "ellipse", "text", "leader", "dimension"] as const;

/**
 * Dimension kinds, as AutoCAD's DIMLINEAR (horizontal, vertical), DIMALIGNED,
 * DIMANGULAR, DIMRADIUS and DIMDIAMETER. Points: a linear one [a, b, where
 * the line sits]; angular [vertex, first ray point, second ray point, where
 * the arc sits]; radius and diameter [centre, a point on the circle].
 */
export const DIM_KINDS = ["horizontal", "vertical", "aligned", "angular", "radius", "diameter"] as const;
export type DimKind = (typeof DIM_KINDS)[number];
const DIM_POINTS: Record<DimKind, number> = { horizontal: 3, vertical: 3, aligned: 3, angular: 4, radius: 2, diameter: 2 };
export type DraftShape = (typeof DRAFT_SHAPES)[number];

export const LINETYPES = ["continuous", "dashed", "hidden", "center", "phantom", "dot"] as const;
export type Linetype = (typeof LINETYPES)[number];
export const LINETYPE_LABEL: Record<Linetype, string> = {
  continuous: "Solid",
  dashed: "Dashed",
  hidden: "Hidden",
  center: "Centre",
  phantom: "Phantom",
  dot: "Dotted",
};

/** Line weights on paper, in mm, as CAD offers them. */
export const WEIGHTS = [0.05, 0.09, 0.13, 0.18, 0.25, 0.35, 0.5, 0.7, 1] as const;

export const HATCHES = ["solid", "diagonal", "cross", "tiles", "brick", "herringbone", "timber", "concrete", "insulation", "dots"] as const;
export type HatchPattern = (typeof HATCHES)[number];
export const HATCH_LABEL: Record<HatchPattern, string> = {
  solid: "Solid",
  diagonal: "Diagonal lines",
  cross: "Cross hatch",
  tiles: "Square tiles",
  brick: "Brick",
  herringbone: "Herringbone",
  timber: "Timber boards",
  concrete: "Concrete",
  insulation: "Insulation",
  dots: "Dots",
};

export interface Hatch {
  pattern: HatchPattern;
  /** The pattern's repeat in mm on the plan, e.g. 600 for 600 mm tiles. */
  scale: number;
  /** Degrees anticlockwise. */
  angle: number;
  /** Absent: the shape's own colour. */
  color?: string;
}

export interface Draft {
  id: string;
  levelId: string;
  shape: DraftShape;
  /**
   * line: its two ends; polyline: its corners; leader: the arrow's tip first,
   * then its bends; circle, arc and ellipse: the centre; text: where it starts.
   */
  points: Point[];
  /** Polyline: one per segment, tan(sweep/4), positive anticlockwise, 0 straight (as in DXF). */
  bulges?: number[];
  closed?: boolean;
  /** Circle and arc radius; an ellipse's radius along its own x axis. */
  radius?: number;
  /** An ellipse's radius along its own y axis. */
  radius2?: number;
  /** Arc start and end, degrees anticlockwise from +x; the arc runs anticlockwise from start to end. */
  start?: number;
  end?: number;
  /** Ellipse and text, degrees anticlockwise. */
  rotation?: number;
  /** A dimension's kind. */
  dim?: DimKind;
  /** Text, and a leader's words; on a dimension, words in place of the measurement. */
  text?: string;
  /** Text height in mm on the plan. */
  height?: number;
  layer?: string;
  /** Absent: as the layer says. */
  color?: string;
  linetype?: Linetype;
  weight?: number;
  fill?: Hatch;
}

export interface DrawingLayer {
  id: string;
  name: string;
  color: string;
  linetype: Linetype;
  weight: number;
  hidden?: boolean;
  locked?: boolean;
}

export const DEFAULT_LAYER = "drafting";

export const DEFAULT_LAYERS: DrawingLayer[] = [
  { id: DEFAULT_LAYER, name: "Drafting", color: "#1f2421", linetype: "continuous", weight: 0.25 },
  { id: "joinery", name: "Joinery", color: "#8a5a2b", linetype: "continuous", weight: 0.35 },
  { id: "ceiling", name: "Ceiling", color: "#3a6ea5", linetype: "dashed", weight: 0.18 },
  { id: "flooring", name: "Flooring", color: "#6f6a60", linetype: "continuous", weight: 0.13 },
  { id: "hatch", name: "Hatch", color: "#8f8a80", linetype: "continuous", weight: 0.09 },
  { id: "annotation", name: "Annotation", color: "#b03a2e", linetype: "continuous", weight: 0.18 },
  { id: "hidden", name: "Hidden lines", color: "#55595c", linetype: "hidden", weight: 0.18 },
  { id: "centre", name: "Centre lines", color: "#2e7d32", linetype: "center", weight: 0.13 },
];

export const DRAFT_LIMITS = { drafts: 20_000, points: 2_000, layers: 100, text: 500 } as const;
export const DEFAULT_TEXT_HEIGHT = 150;

const fail = (error: string): EditResult => ({ ok: false, error });
const r1 = (v: number) => Math.round(v * 10) / 10;
const rp = (p: Point): Point => ({ x: r1(p.x), y: r1(p.y) });
const norm360 = (a: number) => r1((((a % 360) + 360) % 360));

export function drafts(plan: Plan): Draft[] {
  return plan.drafts ?? [];
}

export function drawingLayers(plan: Plan): DrawingLayer[] {
  return plan.drawingLayers?.length ? plan.drawingLayers : DEFAULT_LAYERS;
}

export function layerOf(plan: Plan, d: Pick<Draft, "layer">): DrawingLayer {
  const layers = drawingLayers(plan);
  return layers.find((l) => l.id === (d.layer ?? DEFAULT_LAYER)) ?? layers.find((l) => l.id === DEFAULT_LAYER) ?? layers[0];
}

/** What a shape looks like once "by layer" is filled in. */
export function styleOf(plan: Plan, d: Draft): { color: string; linetype: Linetype; weight: number; hidden: boolean; locked: boolean } {
  const l = layerOf(plan, d);
  return { color: d.color ?? l.color, linetype: d.linetype ?? l.linetype, weight: d.weight ?? l.weight, hidden: !!l.hidden, locked: !!l.locked };
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

export type Segment = { t: "line"; a: Point; b: Point } | { t: "arc"; c: Point; r: number; /** radians */ a0: number; /** radians, signed: + anticlockwise */ sweep: number };

const TAU = Math.PI * 2;
const at = (c: Point, r: number, a: number): Point => ({ x: c.x + r * Math.cos(a), y: c.y + r * Math.sin(a) });

/** The arc a bulged polyline segment from p to q follows. */
export function bulgeArc(p: Point, q: Point, bulge: number): Extract<Segment, { t: "arc" }> {
  const L = distance(p, q);
  const s = (1 / bulge - bulge) / 2;
  const c = { x: (p.x + q.x) / 2 - (s * (q.y - p.y)) / 2, y: (p.y + q.y) / 2 + (s * (q.x - p.x)) / 2 };
  const r = (L * (1 + bulge * bulge)) / (4 * Math.abs(bulge));
  return { t: "arc", c, r, a0: Math.atan2(p.y - c.y, p.x - c.x), sweep: 4 * Math.atan(bulge) };
}

/** The bulge that makes a segment from p to q pass through `through`. */
export function bulgeThrough(p: Point, through: Point, q: Point): number {
  const circle = circleThrough(p, through, q);
  if (!circle) return 0;
  const a0 = Math.atan2(p.y - circle.c.y, p.x - circle.c.x);
  const am = Math.atan2(through.y - circle.c.y, through.x - circle.c.x);
  const a1 = Math.atan2(q.y - circle.c.y, q.x - circle.c.x);
  const ccw = (x: number) => ((x % TAU) + TAU) % TAU;
  const sweep = ccw(am - a0) <= ccw(a1 - a0) ? ccw(a1 - a0) : -ccw(a0 - a1);
  return Math.tan(sweep / 4);
}

/** The circle through three points, or null when they lie on a line. */
export function circleThrough(a: Point, b: Point, c: Point): { c: Point; r: number } | null {
  const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
  if (Math.abs(d) < 1e-6) return null;
  const a2 = a.x * a.x + a.y * a.y;
  const b2 = b.x * b.x + b.y * b.y;
  const c2 = c.x * c.x + c.y * c.y;
  const centre = { x: (a2 * (b.y - c.y) + b2 * (c.y - a.y) + c2 * (a.y - b.y)) / d, y: (a2 * (c.x - b.x) + b2 * (a.x - c.x) + c2 * (b.x - a.x)) / d };
  return { c: centre, r: distance(centre, a) };
}

/** The arc through three points as start/end degrees anticlockwise, or null when they lie on a line. */
export function arcThrough(a: Point, through: Point, b: Point): { centre: Point; radius: number; start: number; end: number } | null {
  const circle = circleThrough(a, through, b);
  if (!circle) return null;
  const deg = (p: Point) => (Math.atan2(p.y - circle.c.y, p.x - circle.c.x) * 180) / Math.PI;
  const sa = norm360(deg(a));
  const sm = norm360(deg(through));
  const sb = norm360(deg(b));
  const inside = (x: number, s: number, e: number) => norm360(x - s) <= norm360(e - s);
  return inside(sm, sa, sb) ? { centre: circle.c, radius: circle.r, start: sa, end: sb } : { centre: circle.c, radius: circle.r, start: sb, end: sa };
}

/** A shape as lines and arcs (an ellipse as short lines). */
export function segmentsOf(d: Draft): Segment[] {
  const p = d.points;
  switch (d.shape) {
    case "line":
      return p.length >= 2 ? [{ t: "line", a: p[0], b: p[1] }] : [];
    case "polyline":
    case "leader": {
      const out: Segment[] = [];
      const n = d.shape === "polyline" && d.closed ? p.length : p.length - 1;
      for (let i = 0; i < n; i++) {
        const a = p[i];
        const b = p[(i + 1) % p.length];
        const bulge = d.shape === "polyline" ? (d.bulges?.[i] ?? 0) : 0;
        out.push(Math.abs(bulge) > 1e-9 && distance(a, b) > 1e-6 ? bulgeArc(a, b, bulge) : { t: "line", a, b });
      }
      return out;
    }
    case "circle":
      return [{ t: "arc", c: p[0], r: d.radius ?? 0, a0: 0, sweep: TAU }];
    case "arc": {
      const s = ((d.start ?? 0) * Math.PI) / 180;
      const e = ((d.end ?? 0) * Math.PI) / 180;
      const sweep = (((e - s) % TAU) + TAU) % TAU || TAU;
      return [{ t: "arc", c: p[0], r: d.radius ?? 0, a0: s, sweep }];
    }
    case "ellipse": {
      const pts = ellipsePoints(d, 72);
      return pts.map((a, i) => ({ t: "line", a, b: pts[(i + 1) % pts.length] }));
    }
    case "text":
    case "dimension":
      return [];
  }
}

export function ellipsePoints(d: Draft, steps = 72): Point[] {
  const c = d.points[0];
  const rx = d.radius ?? 0;
  const ry = d.radius2 ?? rx;
  const rot = ((d.rotation ?? 0) * Math.PI) / 180;
  const out: Point[] = [];
  for (let i = 0; i < steps; i++) {
    const t = (i / steps) * TAU;
    const x = rx * Math.cos(t);
    const y = ry * Math.sin(t);
    out.push({ x: c.x + x * Math.cos(rot) - y * Math.sin(rot), y: c.y + x * Math.sin(rot) + y * Math.cos(rot) });
  }
  return out;
}

/** Points along a segment, ends included. */
export function sampleSegment(s: Segment, maxStep = Math.PI / 18): Point[] {
  if (s.t === "line") return [s.a, s.b];
  const n = Math.max(2, Math.ceil(Math.abs(s.sweep) / maxStep));
  return Array.from({ length: n + 1 }, (_, i) => at(s.c, s.r, s.a0 + (s.sweep * i) / n));
}

/** The shape as one or more runs of points, for picking, boxes and outlines. */
export function draftPolyline(d: Draft): { points: Point[]; closed: boolean } {
  if (d.shape === "text") return { points: textBox(d), closed: true };
  if (d.shape === "dimension") return { points: dimensionOutline(d), closed: false };
  if (d.shape === "ellipse") return { points: ellipsePoints(d, 48), closed: true };
  const segs = segmentsOf(d);
  if (!segs.length) return { points: [...d.points], closed: false };
  const points: Point[] = [];
  for (const s of segs) {
    const run = sampleSegment(s, Math.PI / 12);
    points.push(...(points.length ? run.slice(1) : run));
  }
  const closed = d.shape === "circle" || (d.shape === "polyline" && !!d.closed);
  if (closed && points.length > 1 && distance(points[0], points[points.length - 1]) < 1e-6) points.pop();
  return { points, closed };
}

/** A text's box on the plan, roughly: 0.6 of its height per character. */
export function textBox(d: Draft): Point[] {
  const h = d.height ?? DEFAULT_TEXT_HEIGHT;
  const lines = (d.text ?? "").split("\n");
  const w = Math.max(1, ...lines.map((l) => l.length)) * h * 0.6;
  const tall = h * (1 + (lines.length - 1) * 1.4);
  const a = ((d.rotation ?? 0) * Math.PI) / 180;
  const o = d.points[0];
  const rot = (x: number, y: number) => ({ x: o.x + x * Math.cos(a) - y * Math.sin(a), y: o.y + x * Math.sin(a) + y * Math.cos(a) });
  return [rot(0, -tall + h), rot(w, -tall + h), rot(w, h), rot(0, h)];
}

export function isClosed(d: Draft): boolean {
  // Two points close when an arc segment bends between them, as a half circle does.
  return d.shape === "circle" || d.shape === "ellipse" || (d.shape === "polyline" && !!d.closed && (d.points.length >= 3 || (d.points.length === 2 && !!d.bulges?.some((b) => Math.abs(b) > 1e-9))));
}

/** How long its lines run, in mm. */
export function draftLength(d: Draft): number {
  if (d.shape === "ellipse") {
    const pts = ellipsePoints(d, 180);
    return pts.reduce((s, p, i) => s + distance(p, pts[(i + 1) % pts.length]), 0);
  }
  return segmentsOf(d).reduce((s, g) => s + (g.t === "line" ? distance(g.a, g.b) : Math.abs(g.sweep) * g.r), 0);
}

/** The area a closed shape encloses, in mm²; 0 for an open one. */
export function draftArea(d: Draft): number {
  if (d.shape === "circle") return Math.PI * (d.radius ?? 0) ** 2;
  if (d.shape === "ellipse") return Math.PI * (d.radius ?? 0) * (d.radius2 ?? d.radius ?? 0);
  if (!isClosed(d)) return 0;
  // Shoelace over the corners, plus or minus each arc segment's bulge.
  let area = 0;
  const p = d.points;
  for (let i = 0; i < p.length; i++) {
    const a = p[i];
    const b = p[(i + 1) % p.length];
    area += (a.x * b.y - b.x * a.y) / 2;
    const bulge = d.bulges?.[i] ?? 0;
    if (Math.abs(bulge) > 1e-9) {
      const arc = bulgeArc(a, b, bulge);
      const theta = Math.abs(arc.sweep);
      area += Math.sign(bulge) * ((arc.r * arc.r) / 2) * (theta - Math.sin(theta));
    }
  }
  return Math.abs(area);
}

export function draftBounds(d: Draft): { minX: number; minY: number; maxX: number; maxY: number } {
  const pts = draftPolyline(d).points;
  const list = pts.length ? pts : d.points;
  return {
    minX: Math.min(...list.map((q) => q.x)),
    minY: Math.min(...list.map((q) => q.y)),
    maxX: Math.max(...list.map((q) => q.x)),
    maxY: Math.max(...list.map((q) => q.y)),
  };
}

function toSegment(p: Point, a: Point, b: Point): number {
  const len2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2 || 1;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / len2));
  return distance(p, { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
}

function insidePolygon(p: Point, poly: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y || 1e-12) + a.x) inside = !inside;
  }
  return inside;
}

/** How far a point is from a shape's lines (0 inside a filled shape or on a text). */
export function distanceTo(d: Draft, p: Point): number {
  const { points, closed } = draftPolyline(d);
  if ((d.shape === "text" || (d.fill && closed)) && insidePolygon(p, points)) return 0;
  if (points.length === 1) return distance(p, points[0]);
  let best = Infinity;
  const n = closed ? points.length : points.length - 1;
  for (let i = 0; i < n; i++) best = Math.min(best, toSegment(p, points[i], points[(i + 1) % points.length]));
  return best;
}

export type DraftSnapKind = "end" | "middle" | "centre" | "quadrant" | "node";

/** The points a click snaps to on a shape: ends, middles, centres and quadrants. */
export function snapPointsOf(d: Draft): { point: Point; kind: DraftSnapKind }[] {
  const out: { point: Point; kind: DraftSnapKind }[] = [];
  const p = d.points;
  switch (d.shape) {
    case "line":
    case "polyline":
    case "leader": {
      for (const q of p) out.push({ point: q, kind: "end" });
      for (const s of segmentsOf(d)) {
        if (s.t === "line") out.push({ point: { x: (s.a.x + s.b.x) / 2, y: (s.a.y + s.b.y) / 2 }, kind: "middle" });
        else {
          out.push({ point: at(s.c, s.r, s.a0 + s.sweep / 2), kind: "middle" });
          out.push({ point: s.c, kind: "centre" });
        }
      }
      break;
    }
    case "circle": {
      const r = d.radius ?? 0;
      out.push({ point: p[0], kind: "centre" });
      for (let k = 0; k < 4; k++) out.push({ point: at(p[0], r, (k * Math.PI) / 2), kind: "quadrant" });
      break;
    }
    case "arc": {
      const [s] = segmentsOf(d) as Extract<Segment, { t: "arc" }>[];
      out.push({ point: p[0], kind: "centre" });
      out.push({ point: at(s.c, s.r, s.a0), kind: "end" });
      out.push({ point: at(s.c, s.r, s.a0 + s.sweep), kind: "end" });
      out.push({ point: at(s.c, s.r, s.a0 + s.sweep / 2), kind: "middle" });
      for (let k = 0; k < 4; k++) {
        const a = (k * Math.PI) / 2;
        if ((((a - s.a0) % TAU) + TAU) % TAU <= s.sweep) out.push({ point: at(s.c, s.r, a), kind: "quadrant" });
      }
      break;
    }
    case "ellipse": {
      const rot = ((d.rotation ?? 0) * Math.PI) / 180;
      const rx = d.radius ?? 0;
      const ry = d.radius2 ?? rx;
      out.push({ point: p[0], kind: "centre" });
      for (const [x, y] of [[rx, 0], [0, ry], [-rx, 0], [0, -ry]])
        out.push({ point: { x: p[0].x + x * Math.cos(rot) - y * Math.sin(rot), y: p[0].y + x * Math.sin(rot) + y * Math.cos(rot) }, kind: "quadrant" });
      break;
    }
    case "text":
      out.push({ point: p[0], kind: "node" });
      break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Dimensions
// ---------------------------------------------------------------------------

export const DIM_NAME: Record<DimKind, string> = {
  horizontal: "Horizontal dimension",
  vertical: "Vertical dimension",
  aligned: "Aligned dimension",
  angular: "Angle dimension",
  radius: "Radius dimension",
  diameter: "Diameter dimension",
};

/** What a dimension draws: extension and dimension lines, arcs, ticks, arrows and its words. */
export interface DimParts {
  lines: [Point, Point][];
  arcs: { c: Point; r: number; a0: number; sweep: number }[];
  /** Architectural ticks: short strokes at 45° to the dimension line, which runs at `angle` (radians). */
  ticks: { at: Point; angle: number }[];
  arrows: { tip: Point; from: Point }[];
  /** The words' baseline centre and angle (radians), turned to read the right way up. */
  text: { at: Point; value: string; angle: number };
}

const unitOf = (a: Point, b: Point): Point => {
  const l = distance(a, b) || 1;
  return { x: (b.x - a.x) / l, y: (b.y - a.y) / l };
};
const ccwRad = (a: number) => ((a % TAU) + TAU) % TAU;
/** An angle turned to read the right way up: within (-90°, 90°]. */
const readable = (a: number) => {
  let r = Math.atan2(Math.sin(a), Math.cos(a));
  if (r > Math.PI / 2 + 1e-9) r -= Math.PI;
  if (r <= -Math.PI / 2 + 1e-9) r += Math.PI;
  return r;
};

/** The measurement: mm for lengths, radii and diameters, degrees for angles. */
export function dimensionValue(d: Draft): number {
  const p = d.points;
  switch (d.dim) {
    case "horizontal":
    case "vertical": {
      const u = linearAxis(d);
      return Math.abs((p[1].x - p[0].x) * u.x + (p[1].y - p[0].y) * u.y);
    }
    case "aligned":
      return distance(p[0], p[1]);
    case "radius":
      return distance(p[0], p[1]);
    case "diameter":
      return 2 * distance(p[0], p[1]);
    case "angular":
      return (angularSweep(d).sweep * 180) / Math.PI;
    default:
      return 0;
  }
}

/** The direction a horizontal or vertical dimension measures along, turned by its rotation. */
function linearAxis(d: Draft): Point {
  const a = (((d.rotation ?? 0) + (d.dim === "vertical" ? 90 : 0)) * Math.PI) / 180;
  return { x: Math.cos(a), y: Math.sin(a) };
}

/** An angular dimension's arc: from a0, anticlockwise by sweep, on the side its placement point is. */
function angularSweep(d: Draft): { a0: number; sweep: number } {
  const [v, p1, p2, at] = d.points;
  const a1 = Math.atan2(p1.y - v.y, p1.x - v.x);
  const a2 = Math.atan2(p2.y - v.y, p2.x - v.x);
  const aa = Math.atan2(at.y - v.y, at.x - v.x);
  const s = ccwRad(a2 - a1);
  return ccwRad(aa - a1) <= s ? { a0: a1, sweep: s } : { a0: a2, sweep: TAU - s };
}

/** The words on a dimension: its measurement, or its own words with <> standing for the measurement. */
export function dimensionLabel(d: Draft): string {
  const v = dimensionValue(d);
  const measured =
    d.dim === "angular" ? `${Math.round(v * 10) / 10}°` : d.dim === "radius" ? `R${Math.round(v)}` : d.dim === "diameter" ? `Ø${Math.round(v)}` : String(Math.round(v));
  return d.text ? d.text.replace("<>", measured) : measured;
}

export function dimensionParts(d: Draft): DimParts {
  const h = d.height ?? DEFAULT_TEXT_HEIGHT;
  const gap = h * 0.3;
  const over = h * 0.6;
  const p = d.points;
  const value = dimensionLabel(d);
  const parts: DimParts = { lines: [], arcs: [], ticks: [], arrows: [], text: { at: p[0], value, angle: 0 } };
  /** An extension line from a measured point out to (and a little past) the dimension line. */
  const extension = (from: Point, to: Point) => {
    const L = distance(from, to);
    if (L < gap + 1) return;
    const u = unitOf(from, to);
    parts.lines.push([{ x: from.x + u.x * gap, y: from.y + u.y * gap }, { x: to.x + u.x * over, y: to.y + u.y * over }]);
  };
  const label = (a: Point, b: Point) => {
    const angle = readable(Math.atan2(b.y - a.y, b.x - a.x));
    const up = { x: -Math.sin(angle), y: Math.cos(angle) };
    parts.text = { at: { x: (a.x + b.x) / 2 + up.x * h * 0.4, y: (a.y + b.y) / 2 + up.y * h * 0.4 }, value, angle };
  };
  switch (d.dim) {
    case "horizontal":
    case "vertical":
    case "aligned": {
      const [a, b, at] = p;
      let A: Point;
      let B: Point;
      if (d.dim !== "aligned") {
        // The dimension line runs through `at` along the axis; the ends are the measured points brought square onto it.
        const u = linearAxis(d);
        const onLine = (q: Point) => {
          const t = (q.x - at.x) * u.x + (q.y - at.y) * u.y;
          return { x: at.x + u.x * t, y: at.y + u.y * t };
        };
        A = onLine(a);
        B = onLine(b);
      } else {
        const u = unitOf(a, b);
        const n = { x: -u.y, y: u.x };
        const off = (at.x - a.x) * n.x + (at.y - a.y) * n.y;
        A = { x: a.x + n.x * off, y: a.y + n.y * off };
        B = { x: b.x + n.x * off, y: b.y + n.y * off };
      }
      extension(a, A);
      extension(b, B);
      parts.lines.push([A, B]);
      const angle = Math.atan2(B.y - A.y, B.x - A.x);
      parts.ticks.push({ at: A, angle }, { at: B, angle });
      label(A, B);
      break;
    }
    case "angular": {
      const [v, p1, p2, at] = p;
      const r = distance(v, at);
      const { a0, sweep } = angularSweep(d);
      for (const q of [p1, p2]) {
        const u = unitOf(v, q);
        if (distance(v, q) < r) extension(q, { x: v.x + u.x * r, y: v.y + u.y * r });
      }
      parts.arcs.push({ c: v, r, a0, sweep });
      const da = Math.min(sweep / 3, (h * 0.8) / Math.max(r, 1));
      const on = (a: number): Point => ({ x: v.x + r * Math.cos(a), y: v.y + r * Math.sin(a) });
      parts.arrows.push({ tip: on(a0), from: on(a0 + da) }, { tip: on(a0 + sweep), from: on(a0 + sweep - da) });
      const mid = a0 + sweep / 2;
      const angle = readable(mid - Math.PI / 2);
      // The words sit just outside the arc, whichever way up they read.
      const upOut = -Math.sin(angle) * Math.cos(mid) + Math.cos(angle) * Math.sin(mid) > 0;
      const out = r + h * (upOut ? 0.4 : 1.4);
      parts.text = { at: { x: v.x + out * Math.cos(mid), y: v.y + out * Math.sin(mid) }, value, angle };
      break;
    }
    case "radius":
    case "diameter": {
      const [c, e] = p;
      const far = d.dim === "diameter" ? { x: 2 * c.x - e.x, y: 2 * c.y - e.y } : c;
      parts.lines.push([far, e]);
      parts.arrows.push({ tip: e, from: c });
      if (d.dim === "diameter") parts.arrows.push({ tip: far, from: c });
      label(d.dim === "diameter" ? c : { x: (c.x + e.x) / 2, y: (c.y + e.y) / 2 }, e);
      if (d.dim === "radius") {
        const angle = readable(Math.atan2(e.y - c.y, e.x - c.x));
        const up = { x: -Math.sin(angle), y: Math.cos(angle) };
        parts.text = { at: { x: (c.x + e.x) / 2 + up.x * h * 0.4, y: (c.y + e.y) / 2 + up.y * h * 0.4 }, value, angle };
      }
      break;
    }
  }
  return parts;
}

/**
 * AutoCAD's DIMLINEAR choice: placed above or below the two points, a
 * dimension measures across (horizontal); placed to a side, up (vertical);
 * placed between them, whichever way they are further apart.
 */
export function linearKind(a: Point, b: Point, at: Point): "horizontal" | "vertical" {
  const beyondY = at.y > Math.max(a.y, b.y) || at.y < Math.min(a.y, b.y);
  const beyondX = at.x > Math.max(a.x, b.x) || at.x < Math.min(a.x, b.x);
  if (beyondY && !beyondX) return "horizontal";
  if (beyondX && !beyondY) return "vertical";
  return Math.abs(b.x - a.x) >= Math.abs(b.y - a.y) ? "horizontal" : "vertical";
}

/**
 * A chain of dimensions, each from one point to the next, all on one line
 * through `at` (AutoCAD's DIMCONTINUE). Linear chains pick horizontal or
 * vertical from the whole run.
 */
export function chainDimensions(plan: Plan, input: { levelId: string; points: Point[]; at: Point; kind?: "horizontal" | "vertical" | "aligned" } & Pick<Draft, "layer" | "color" | "linetype" | "weight" | "height">): EditResult {
  const { points, at, kind: wanted, ...rest } = input;
  if (points.length < 2) return fail("A chain needs two or more points.");
  const first = points[0];
  const last = points[points.length - 1];
  const kind = wanted ?? linearKind(first, last, at);
  let next = plan;
  const created: { kind: "draft"; id: string }[] = [];
  for (let i = 0; i + 1 < points.length; i++) {
    const r = addDraft(next, { ...rest, shape: "dimension", dim: kind, points: [points[i], points[i + 1], at] });
    if (!r.ok) {
      if (/nothing to measure/.test(r.error)) continue;
      return r;
    }
    next = r.plan;
    created.push({ kind: "draft", id: r.id! });
  }
  if (!created.length) return fail("There is nothing to measure between those points.");
  return { ok: true, plan: next, summary: `A chain of ${created.length} ${kind} dimension${created.length === 1 ? "" : "s"} drawn`, id: created[0].id, created };
}

/** A dimension's lines as one run of points, for picking and its box. */
function dimensionOutline(d: Draft): Point[] {
  if (!d.dim || d.points.length < DIM_POINTS[d.dim]) return [...d.points];
  const parts = dimensionParts(d);
  if (d.dim === "angular") {
    const a = parts.arcs[0];
    return [d.points[1], ...sampleSegment({ t: "arc", c: a.c, r: a.r, a0: a.a0, sweep: a.sweep }), d.points[2]];
  }
  if (d.dim === "radius" || d.dim === "diameter") return [...parts.lines[0]];
  const dimLine = parts.lines[parts.lines.length - 1];
  return [d.points[0], dimLine[0], dimLine[1], d.points[1]];
}

// ---------------------------------------------------------------------------
// Moving, turning, mirroring and scaling
// ---------------------------------------------------------------------------

/**
 * A shape put through a move, turn, mirror or uniform scale given as a point
 * function. Circles and arcs keep their shape; a mirror flips arcs and bulges
 * the other way round, and keeps text readable.
 */
export function transformDraft(d: Draft, f: (p: Point) => Point): Draft {
  const o = f({ x: 0, y: 0 });
  const ex = f({ x: 1000, y: 0 });
  const ey = f({ x: 0, y: 1000 });
  const ux = { x: (ex.x - o.x) / 1000, y: (ex.y - o.y) / 1000 };
  const uy = { x: (ey.x - o.x) / 1000, y: (ey.y - o.y) / 1000 };
  const flips = ux.x * uy.y - ux.y * uy.x < 0;
  const k = Math.hypot(ux.x, ux.y);
  const turn = (Math.atan2(ux.y, ux.x) * 180) / Math.PI;
  const angle = (deg: number) => {
    // Where a direction at `deg` ends up.
    const a = (deg * Math.PI) / 180;
    const v = { x: ux.x * Math.cos(a) + uy.x * Math.sin(a), y: ux.y * Math.cos(a) + uy.y * Math.sin(a) };
    return (Math.atan2(v.y, v.x) * 180) / Math.PI;
  };
  const next: Draft = { ...d, points: d.points.map((p) => rp(f(p))) };
  if (d.radius != null) next.radius = r1(d.radius * k);
  if (d.radius2 != null) next.radius2 = r1(d.radius2 * k);
  if (d.height != null && d.shape === "text") next.height = r1(d.height * k);
  if (d.fill) next.fill = { ...d.fill, scale: r1(d.fill.scale * k), angle: norm360(flips ? -d.fill.angle + 2 * turn : d.fill.angle + turn) };
  if (d.shape === "arc") {
    const s = angle(d.start ?? 0);
    const e = angle(d.end ?? 0);
    next.start = norm360(flips ? e : s);
    next.end = norm360(flips ? s : e);
  }
  if (d.shape === "ellipse") next.rotation = norm360(angle(d.rotation ?? 0));
  if (d.shape === "text") {
    // A mirrored text still reads the right way up, as with AutoCAD's MIRRTEXT 0.
    let r = norm360(angle(d.rotation ?? 0));
    if (flips && r > 90 && r <= 270) r = norm360(r - 180);
    next.rotation = r;
  }
  if (flips && d.bulges) next.bulges = d.bulges.map((b) => -b);
  // A horizontal or vertical dimension turns with its rotation, as CAD's rotated linear dimension.
  if (d.shape === "dimension" && (d.dim === "horizontal" || d.dim === "vertical")) next.rotation = norm360(angle(d.rotation ?? 0));
  return next;
}

// ---------------------------------------------------------------------------
// Checking and editing
// ---------------------------------------------------------------------------

const SHAPE_NAME: Record<DraftShape, string> = {
  line: "Line",
  polyline: "Polyline",
  circle: "Circle",
  arc: "Arc",
  ellipse: "Ellipse",
  text: "Text",
  leader: "Leader",
  dimension: "Dimension",
};

export function draftName(d: Draft): string {
  if (d.shape === "dimension") return d.dim ? DIM_NAME[d.dim] : "Dimension";
  if (d.fill && d.shape === "polyline") return "Hatch";
  if (d.shape === "polyline" && d.closed && d.points.length === 4 && !d.bulges?.some((b) => b)) {
    const [a, b, c] = d.points;
    const dot = (b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y);
    if (Math.abs(dot) < 1e-3 * (distance(a, b) * distance(b, c) || 1)) return "Rectangle";
  }
  if (d.fill) return `Hatched ${SHAPE_NAME[d.shape].toLowerCase()}`;
  return SHAPE_NAME[d.shape];
}

/** One line on a shape for the log and the assistant. */
export function describeDraft(d: Draft): string {
  const name = draftName(d);
  switch (d.shape) {
    case "line":
      return `${name}, ${mm(draftLength(d))}`;
    case "circle":
      return `${name}, radius ${mm(d.radius ?? 0)}`;
    case "arc":
      return `${name}, radius ${mm(d.radius ?? 0)}, ${Math.round(norm360((d.end ?? 0) - (d.start ?? 0)) || 360)}°`;
    case "ellipse":
      return `${name}, ${mm(2 * (d.radius ?? 0))} by ${mm(2 * (d.radius2 ?? 0))}`;
    case "text":
      return `${name} "${(d.text ?? "").slice(0, 40)}"`;
    case "leader":
      return `${name}${d.text ? ` "${d.text.slice(0, 40)}"` : ""}`;
    case "polyline":
      return isClosed(d) ? `${name}, ${(draftArea(d) / 1e6).toFixed(2)} m²` : `${name}, ${mm(draftLength(d))}`;
    case "dimension":
      return `${name}, ${dimensionLabel(d)}${d.dim === "angular" ? "" : " mm"}`;
  }
}

/** What is wrong with a shape, or null when it can go on the plan. */
export function draftProblem(plan: Plan, d: Draft): string | null {
  if (!DRAFT_SHAPES.includes(d.shape)) return "That is not a shape the plan can draw.";
  if (!d.points.length || d.points.length > DRAFT_LIMITS.points) return "A shape needs between 1 and 2,000 points.";
  if (!d.points.every((p) => finite(p.x, p.y))) return "That point is off the plan.";
  if (d.layer != null && !drawingLayers(plan).some((l) => l.id === d.layer)) return `There is no drawing layer "${d.layer}".`;
  const positive = (v: number | undefined) => v != null && Number.isFinite(v) && v > 0 && v <= LIMITS.maxWall;
  switch (d.shape) {
    case "line":
      if (d.points.length !== 2 || distance(d.points[0], d.points[1]) < 0.5) return "A line needs two different ends.";
      break;
    case "polyline":
      if (d.points.length < 2 || (d.closed && !isClosed(d))) return "A polyline needs two or more corners, and three to close (or two with an arc between them).";
      if (d.bulges && (d.bulges.length > d.points.length || !d.bulges.every((b) => Number.isFinite(b) && Math.abs(b) <= 10))) return "Each arc segment's bulge must be a number between -10 and 10.";
      break;
    case "leader":
      if (d.points.length < 2) return "A leader needs its arrow point and at least one more.";
      break;
    case "circle":
      if (!positive(d.radius)) return "Give the circle a radius.";
      break;
    case "arc":
      if (!positive(d.radius)) return "Give the arc a radius.";
      if (!Number.isFinite(d.start) || !Number.isFinite(d.end) || Math.abs(norm360((d.end ?? 0) - (d.start ?? 0))) < 0.05) return "An arc needs a start and an end angle that differ.";
      break;
    case "ellipse":
      if (!positive(d.radius) || !positive(d.radius2)) return "An ellipse needs both radii.";
      break;
    case "text":
      if (!d.text?.trim()) return "Type the text.";
      break;
    case "dimension": {
      if (!d.dim || !DIM_KINDS.includes(d.dim)) return "Say which kind of dimension: horizontal, vertical, aligned, angular, radius or diameter.";
      if (d.points.length !== DIM_POINTS[d.dim]) return `A ${d.dim} dimension needs ${DIM_POINTS[d.dim]} points.`;
      if (d.dim === "angular") {
        const [v, p1, p2] = d.points;
        if (distance(v, p1) < 0.5 || distance(v, p2) < 0.5 || distance(v, d.points[3]) < 0.5) return "An angle dimension needs its corner, a point on each side and where the arc goes, all apart.";
        if (dimensionValue(d) < 0.05) return "Those two sides are the same line, so there is no angle.";
      } else if (dimensionValue(d) < 0.5) return "There is nothing to measure between those points.";
      break;
    }
  }
  if (d.text != null && d.text.length > DRAFT_LIMITS.text) return "Text can be up to 500 characters.";
  if (d.height != null && !positive(d.height)) return "Give the text a height in mm.";
  if (d.weight != null && !(d.weight > 0 && d.weight <= 2)) return "A line weight is between 0.05 and 2 mm.";
  if (d.fill) {
    if (!isClosed(d)) return "Only closed shapes can be hatched: close the polyline first.";
    if (!HATCHES.includes(d.fill.pattern)) return "That is not a hatch pattern.";
    if (!(d.fill.scale > 0 && d.fill.scale <= 100_000)) return "A hatch's scale is its repeat in mm, more than 0.";
  }
  return null;
}

/** Puts a new shape on the plan. */
export function addDraft(plan: Plan, input: Omit<Draft, "id"> & { id?: string }): EditResult {
  if (drafts(plan).length >= DRAFT_LIMITS.drafts) return fail("The plan has as many drawn shapes as it can hold.");
  const d: Draft = clean({ ...input, id: input.id ?? newId(), points: input.points.map(rp) });
  const problem = draftProblem(plan, d);
  if (problem) return fail(problem);
  return { ok: true, plan: { ...plan, drafts: [...drafts(plan), d] }, summary: `${describeDraft(d)} drawn`, id: d.id, created: [{ kind: "draft", id: d.id }] };
}

/** Changes a shape; a null in the patch takes a setting back to "by layer". */
export function updateDraft(plan: Plan, id: string, patch: { [K in keyof Omit<Draft, "id" | "levelId">]?: Draft[K] | null }): EditResult {
  const d = drafts(plan).find((x) => x.id === id);
  if (!d) return fail("That shape is no longer on the plan.");
  const next = { ...d } as Record<string, unknown>;
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    if (v === null) delete next[k];
    else next[k] = v;
  }
  const merged = clean(next as unknown as Draft);
  if (merged.points) merged.points = merged.points.map(rp);
  const problem = draftProblem(plan, merged);
  if (problem) return fail(problem);
  if (JSON.stringify(merged) === JSON.stringify(d)) return { ok: true, plan, summary: "" };
  return { ok: true, plan: { ...plan, drafts: drafts(plan).map((x) => (x.id === id ? merged : x)) }, summary: `${draftName(merged)} changed` };
}

function clean(d: Draft): Draft {
  const out = { ...d };
  if (out.shape !== "polyline" || !out.bulges?.some((b) => Math.abs(b) > 1e-9)) delete out.bulges;
  if (out.shape !== "polyline") delete out.closed;
  else if (!out.closed) delete out.closed;
  if (out.text != null && out.shape !== "text" && out.shape !== "leader" && out.shape !== "dimension") delete out.text;
  if (out.shape !== "dimension") delete out.dim;
  return out;
}

/** A rectangle from two opposite corners, as a closed polyline. */
export function rectangle(a: Point, b: Point): Point[] {
  return [a, { x: b.x, y: a.y }, b, { x: a.x, y: b.y }];
}

/** A regular polygon's corners, from its centre and one corner. */
export function polygon(centre: Point, corner: Point, sides: number): Point[] {
  const n = Math.max(3, Math.min(64, Math.round(sides)));
  const r = distance(centre, corner);
  const a0 = Math.atan2(corner.y - centre.y, corner.x - centre.x);
  return Array.from({ length: n }, (_, i) => at(centre, r, a0 + (i * TAU) / n));
}

// ---------------------------------------------------------------------------
// Drawing layers
// ---------------------------------------------------------------------------

/** Adds a drawing layer or changes one; the defaults are written into the plan the first time. */
export function setDrawingLayer(plan: Plan, layer: Partial<DrawingLayer> & { id?: string; name?: string }): EditResult {
  const layers = drawingLayers(plan);
  const existing = layer.id ? layers.find((l) => l.id === layer.id) : layers.find((l) => l.name.toLowerCase() === layer.name?.trim().toLowerCase());
  const name = (layer.name ?? existing?.name ?? "").trim().slice(0, 80);
  if (!name) return fail("Give the layer a name.");
  if (layers.some((l) => l !== existing && l.name.toLowerCase() === name.toLowerCase())) return fail(`There is already a layer called ${name}.`);
  if (!existing && layers.length >= DRAFT_LIMITS.layers) return fail("The plan has as many drawing layers as it can hold.");
  const color = layer.color ?? existing?.color ?? "#1f2421";
  if (!/^#[0-9a-fA-F]{6}$/.test(color)) return fail("Colours are written like #1f2421.");
  const linetype = layer.linetype ?? existing?.linetype ?? "continuous";
  if (!LINETYPES.includes(linetype)) return fail("That is not a line type.");
  const weight = layer.weight ?? existing?.weight ?? 0.25;
  if (!(weight > 0 && weight <= 2)) return fail("A line weight is between 0.05 and 2 mm.");
  const next: DrawingLayer = {
    id: existing?.id ?? layer.id ?? (name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || newId()),
    name,
    color,
    linetype,
    weight,
    ...((layer.hidden ?? existing?.hidden) ? { hidden: true } : {}),
    ...((layer.locked ?? existing?.locked) ? { locked: true } : {}),
  };
  if (!existing && layers.some((l) => l.id === next.id)) next.id = `${next.id}-${newId().slice(0, 6)}`;
  const list = existing ? layers.map((l) => (l === existing ? next : l)) : [...layers, next];
  const what = existing
    ? [existing.name !== next.name && `renamed ${next.name}`, existing.hidden !== next.hidden && (next.hidden ? "hidden" : "shown"), existing.locked !== next.locked && (next.locked ? "locked" : "unlocked"), (existing.color !== next.color || existing.linetype !== next.linetype || existing.weight !== next.weight) && "restyled"].filter(Boolean).join(", ")
    : "added";
  return { ok: true, plan: { ...plan, drawingLayers: list }, summary: `Drawing layer ${existing?.name ?? name} ${what || "unchanged"}`, id: next.id };
}

/** Removes a drawing layer; its shapes move to `moveTo` (the Drafting layer unless given). */
export function removeDrawingLayer(plan: Plan, id: string, moveTo = DEFAULT_LAYER): EditResult {
  const layers = drawingLayers(plan);
  const layer = layers.find((l) => l.id === id);
  if (!layer) return fail("That layer is no longer on the plan.");
  if (id === DEFAULT_LAYER) return fail("The Drafting layer stays; it is where shapes go by default.");
  if (!layers.some((l) => l.id === moveTo) || moveTo === id) return fail("Pick another layer for its shapes.");
  const moved = drafts(plan).filter((d) => (d.layer ?? DEFAULT_LAYER) === id).length;
  return {
    ok: true,
    plan: {
      ...plan,
      drawingLayers: layers.filter((l) => l.id !== id),
      drafts: drafts(plan).map((d) => {
        if ((d.layer ?? DEFAULT_LAYER) !== id) return d;
        const next: Draft = { ...d, layer: moveTo };
        if (moveTo === DEFAULT_LAYER) delete next.layer;
        return next;
      }),
    },
    summary: `Drawing layer ${layer.name} removed${moved ? `; its ${moved} shape${moved === 1 ? "" : "s"} moved to ${layers.find((l) => l.id === moveTo)!.name}` : ""}`,
  };
}

const xy = (p: Point) => `(${Math.round(p.x)}, ${Math.round(p.y)})`;

/** A shape in full for the assistant: its id, layer, geometry and style. */
export function describeDraftFull(plan: Plan, d: Draft): string {
  const layer = layerOf(plan, d);
  const geo =
    d.shape === "circle" ? `centre ${xy(d.points[0])}, radius ${r1(d.radius ?? 0)}`
    : d.shape === "arc" ? `centre ${xy(d.points[0])}, radius ${r1(d.radius ?? 0)}, from ${d.start}° to ${d.end}° anticlockwise`
    : d.shape === "ellipse" ? `centre ${xy(d.points[0])}, radii ${r1(d.radius ?? 0)} × ${r1(d.radius2 ?? 0)}, turned ${d.rotation ?? 0}°`
    : d.shape === "text" ? `"${d.text}" at ${xy(d.points[0])}, ${d.height ?? DEFAULT_TEXT_HEIGHT} mm high${d.rotation ? `, turned ${d.rotation}°` : ""}`
    : `points ${d.points.map(xy).join(" ")}${d.closed ? " (closed)" : ""}${d.bulges?.some((b) => b) ? `, bulges ${d.bulges.map((b) => r1(b * 1000) / 1000).join(" ")}` : ""}${d.text ? `, text "${d.text}"` : ""}`;
  const style = [d.color && `colour ${d.color}`, d.linetype && `${d.linetype} line`, d.weight && `${d.weight} mm weight`].filter(Boolean).join(", ");
  return `${draftName(d).toLowerCase()} [draft ${d.id}] on layer ${layer.name}: ${geo}${style ? `; ${style}` : ""}${d.fill ? `; hatched ${d.fill.pattern} at ${d.fill.scale} mm, ${d.fill.angle}°` : ""}; ${describeDraft(d)}`;
}
