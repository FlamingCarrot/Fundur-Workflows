import type { Connector, ConnectorEnd, ShapeKind, Side, WbElement } from "./types";

/**
 * Whiteboard geometry, free of the screen: bounds, what is under a point,
 * where connectors start and end and how they bend, snapping guides,
 * aligning and spacing, what a frame holds, and smoothing pen strokes.
 */

export interface Pt {
  x: number;
  y: number;
}
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type ById = Map<string, WbElement>;
export const byId = (els: WbElement[]): ById => new Map(els.map((e) => [e.id, e]));

const rad = (deg = 0) => (deg * Math.PI) / 180;

/** The box an element takes up, turned elements included. */
export function bounds(el: WbElement, all?: ById): Rect {
  if (el.kind === "connector" && all) {
    const pts = connectorPoints(el, all);
    return boxOf(pts, el.strokeWidth + 4);
  }
  if (!el.rotation) return { x: el.x, y: el.y, w: el.w, h: el.h };
  const c = centre(el);
  const corners = [
    { x: el.x, y: el.y },
    { x: el.x + el.w, y: el.y },
    { x: el.x + el.w, y: el.y + el.h },
    { x: el.x, y: el.y + el.h },
  ].map((p) => rotate(p, c, el.rotation!));
  return boxOf(corners);
}

export function boxOf(pts: Pt[], pad = 0): Rect {
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const x = Math.min(...xs) - pad;
  const y = Math.min(...ys) - pad;
  return { x, y, w: Math.max(1, Math.max(...xs) + pad - x), h: Math.max(1, Math.max(...ys) + pad - y) };
}

export function union(rects: Rect[]): Rect | null {
  if (!rects.length) return null;
  const x = Math.min(...rects.map((r) => r.x));
  const y = Math.min(...rects.map((r) => r.y));
  return { x, y, w: Math.max(...rects.map((r) => r.x + r.w)) - x, h: Math.max(...rects.map((r) => r.y + r.h)) - y };
}

export const centre = (r: Rect): Pt => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

export function rotate(p: Pt, about: Pt, deg: number): Pt {
  const a = rad(deg);
  const c = Math.cos(a);
  const s = Math.sin(a);
  const dx = p.x - about.x;
  const dy = p.y - about.y;
  return { x: about.x + dx * c - dy * s, y: about.y + dx * s + dy * c };
}

export const contains = (r: Rect, p: Pt) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
export const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
export const inside = (inner: Rect, outer: Rect) => inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h;

/** The middle of one side of a box, where a connector holds on. */
export function sidePoint(r: Rect, side: Side): Pt {
  switch (side) {
    case "top":
      return { x: r.x + r.w / 2, y: r.y };
    case "right":
      return { x: r.x + r.w, y: r.y + r.h / 2 };
    case "bottom":
      return { x: r.x + r.w / 2, y: r.y + r.h };
    case "left":
      return { x: r.x, y: r.y + r.h / 2 };
  }
}

/** The side of a box that faces a point. */
export function facingSide(r: Rect, p: Pt): Side {
  const c = centre(r);
  const dx = (p.x - c.x) / (r.w || 1);
  const dy = (p.y - c.y) / (r.h || 1);
  return Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : dy > 0 ? "bottom" : "top";
}

const DIR: Record<Side, Pt> = { top: { x: 0, y: -1 }, right: { x: 1, y: 0 }, bottom: { x: 0, y: 1 }, left: { x: -1, y: 0 } };

/** Where a connector's end is, and which way it leaves: on its element's side, or loose on the board. */
export function endAt(end: ConnectorEnd, other: Pt, all: ById): { p: Pt; dir: Pt | null } {
  const el = end.id ? all.get(end.id) : undefined;
  if (!el || el.kind === "connector") return { p: { x: end.x, y: end.y }, dir: null };
  const r = { x: el.x, y: el.y, w: el.w, h: el.h };
  const side = end.side ?? facingSide(r, other);
  return { p: sidePoint(r, side), dir: DIR[side] };
}

/** The points a connector passes through, end to end. Curves give their two handles in the middle. */
export function connectorPoints(c: Connector, all: ById): Pt[] {
  const fromEl = c.from.id ? all.get(c.from.id) : undefined;
  const toEl = c.to.id ? all.get(c.to.id) : undefined;
  const aim = (el: WbElement | undefined, end: ConnectorEnd) => (el && el.kind !== "connector" ? centre(el) : { x: end.x, y: end.y });
  const a = endAt(c.from, aim(toEl, c.to), all);
  const b = endAt(c.to, aim(fromEl, c.from), all);
  if (c.route === "straight") return [a.p, b.p];
  const da = a.dir ?? guessDir(a.p, b.p);
  const db = b.dir ?? guessDir(b.p, a.p);
  if (c.route === "curve") {
    const reach = Math.max(40, Math.hypot(b.p.x - a.p.x, b.p.y - a.p.y) * 0.4);
    return [a.p, { x: a.p.x + da.x * reach, y: a.p.y + da.y * reach }, { x: b.p.x + db.x * reach, y: b.p.y + db.y * reach }, b.p];
  }
  return elbow(a.p, da, b.p, db);
}

const guessDir = (from: Pt, to: Pt): Pt => (Math.abs(to.x - from.x) >= Math.abs(to.y - from.y) ? { x: Math.sign(to.x - from.x) || 1, y: 0 } : { x: 0, y: Math.sign(to.y - from.y) || 1 });

/** A right-angled route out of one side and into the other, stepping clear of both. */
function elbow(a: Pt, da: Pt, b: Pt, db: Pt): Pt[] {
  const gap = 24;
  const a1 = { x: a.x + da.x * gap, y: a.y + da.y * gap };
  const b1 = { x: b.x + db.x * gap, y: b.y + db.y * gap };
  const pts: Pt[] = [a, a1];
  const horizontalA = da.x !== 0;
  const horizontalB = db.x !== 0;
  if (horizontalA && horizontalB) {
    const mx = (a1.x + b1.x) / 2;
    pts.push({ x: mx, y: a1.y }, { x: mx, y: b1.y });
  } else if (!horizontalA && !horizontalB) {
    const my = (a1.y + b1.y) / 2;
    pts.push({ x: a1.x, y: my }, { x: b1.x, y: my });
  } else if (horizontalA) pts.push({ x: b1.x, y: a1.y });
  else pts.push({ x: a1.x, y: b1.y });
  pts.push(b1, b);
  return dedupe(pts);
}

function dedupe(pts: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (!last || Math.abs(last.x - p.x) > 0.01 || Math.abs(last.y - p.y) > 0.01) out.push(p);
  }
  // Drop points in the middle of a straight run.
  return out.filter((p, i) => i === 0 || i === out.length - 1 || !((out[i - 1].x === p.x && p.x === out[i + 1].x) || (out[i - 1].y === p.y && p.y === out[i + 1].y)));
}

export function connectorPath(c: Connector, all: ById): string {
  const pts = connectorPoints(c, all);
  if (c.route === "curve" && pts.length === 4) return `M${f(pts[0])} C${f(pts[1])} ${f(pts[2])} ${f(pts[3])}`;
  return pts.map((p, i) => `${i ? "L" : "M"}${f(p)}`).join(" ");
}
const f = (p: Pt) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`;

/** The middle of a connector, for its label. */
export function connectorMid(c: Connector, all: ById): Pt {
  const pts = connectorPoints(c, all);
  if (c.route === "curve" && pts.length === 4) {
    const t = 0.5;
    const m = (k: "x" | "y") => (1 - t) ** 3 * pts[0][k] + 3 * (1 - t) ** 2 * t * pts[1][k] + 3 * (1 - t) * t ** 2 * pts[2][k] + t ** 3 * pts[3][k];
    return { x: m("x"), y: m("y") };
  }
  const lengths = pts.slice(1).map((p, i) => Math.hypot(p.x - pts[i].x, p.y - pts[i].y));
  let half = lengths.reduce((s, l) => s + l, 0) / 2;
  for (let i = 0; i < lengths.length; i++) {
    if (half <= lengths[i]) {
      const t = lengths[i] ? half / lengths[i] : 0;
      return { x: pts[i].x + (pts[i + 1].x - pts[i].x) * t, y: pts[i].y + (pts[i + 1].y - pts[i].y) * t };
    }
    half -= lengths[i];
  }
  return pts[0];
}

export function distToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len)) : 0;
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
}

function curveSamples(pts: Pt[]): Pt[] {
  if (pts.length !== 4) return pts;
  return Array.from({ length: 21 }, (_, i) => {
    const t = i / 20;
    const m = (k: "x" | "y") => (1 - t) ** 3 * pts[0][k] + 3 * (1 - t) ** 2 * t * pts[1][k] + 3 * (1 - t) * t ** 2 * pts[2][k] + t ** 3 * pts[3][k];
    return { x: m("x"), y: m("y") };
  });
}

/** Whether a point (on the board) is on an element; lines and strokes are hit within `slop`. */
export function hits(el: WbElement, p: Pt, slop: number, all: ById): boolean {
  if (el.kind === "connector") {
    const raw = connectorPoints(el, all);
    const pts = el.route === "curve" ? curveSamples(raw) : raw;
    return pts.slice(1).some((q, i) => distToSegment(p, pts[i], q) <= slop + el.strokeWidth / 2);
  }
  // Into the element's own unturned frame.
  const local = el.rotation ? rotate(p, centre(el), -el.rotation) : p;
  if (el.kind === "pen") {
    if (!contains({ x: el.x - slop, y: el.y - slop, w: el.w + slop * 2, h: el.h + slop * 2 }, local)) return false;
    for (let i = 2; i < el.points.length; i += 2) {
      const a = { x: el.x + el.points[i - 2], y: el.y + el.points[i - 1] };
      const b = { x: el.x + el.points[i], y: el.y + el.points[i + 1] };
      if (distToSegment(local, a, b) <= slop + el.strokeWidth / 2) return true;
    }
    return el.points.length === 2 && Math.hypot(local.x - el.x - el.points[0], local.y - el.y - el.points[1]) <= slop + el.strokeWidth;
  }
  return contains({ x: el.x - slop / 2, y: el.y - slop / 2, w: el.w + slop, h: el.h + slop }, local);
}

/** Draw order: frames first, then by z. */
export const drawOrder = (els: WbElement[]) => [...els].sort((a, b) => (a.kind === "frame" ? 0 : 1) - (b.kind === "frame" ? 0 : 1) || a.z - b.z);

/** The element on top at a point. */
export function topAt(els: WbElement[], p: Pt, slop: number): WbElement | null {
  const all = byId(els);
  const order = drawOrder(els).reverse();
  for (const el of order) if (el.kind !== "frame" && hits(el, p, slop, all)) return el;
  // A frame is picked by its title or its edge, so a box can be dragged out inside it, as in FigJam.
  for (const el of order) {
    if (el.kind !== "frame") continue;
    const edge = slop + 4;
    const outer = hits(el, p, edge * 2, all);
    const inner = contains({ x: el.x + edge, y: el.y + edge, w: el.w - edge * 2, h: el.h - edge * 2 }, el.rotation ? rotate(p, centre(el), -el.rotation) : p);
    if ((outer && !inner) || contains({ x: el.x, y: el.y - 28, w: Math.max(el.w, 80), h: 28 }, p)) return el;
  }
  return null;
}

/** The elements a frame holds: anything (but frames) whose middle is inside it. Connectors go with what they join. */
export function frameChildren(frame: WbElement, els: WbElement[]): WbElement[] {
  const all = byId(els);
  return els.filter((e) => e.id !== frame.id && e.kind !== "frame" && e.kind !== "connector" && contains(frame, centre(bounds(e, all))));
}

/** Everything that moves when these move: their groups and what their frames hold. */
export function withAttached(ids: string[], els: WbElement[]): string[] {
  const out = new Set(ids);
  const groups = new Set(els.filter((e) => out.has(e.id) && e.groupId).map((e) => e.groupId!));
  for (const e of els) if (e.groupId && groups.has(e.groupId)) out.add(e.id);
  for (const e of els) if (out.has(e.id) && e.kind === "frame") for (const c of frameChildren(e, els)) out.add(c.id);
  return [...out];
}

export interface Guide {
  axis: "x" | "y";
  at: number;
  from: number;
  to: number;
}

/**
 * Snaps a box being moved to the edges and middles of the others nearby, as
 * Figma and Miro do. Returns the shift to apply and the guides to draw.
 */
export function snapBox(box: Rect, others: Rect[], threshold: number): { dx: number; dy: number; guides: Guide[] } {
  const xs = [box.x, box.x + box.w / 2, box.x + box.w];
  const ys = [box.y, box.y + box.h / 2, box.y + box.h];
  let bestX: { d: number; at: number; o: Rect } | null = null;
  let bestY: { d: number; at: number; o: Rect } | null = null;
  for (const o of others) {
    for (const ox of [o.x, o.x + o.w / 2, o.x + o.w])
      for (const x of xs) {
        const d = ox - x;
        if (Math.abs(d) <= threshold && (!bestX || Math.abs(d) < Math.abs(bestX.d))) bestX = { d, at: ox, o };
      }
    for (const oy of [o.y, o.y + o.h / 2, o.y + o.h])
      for (const y of ys) {
        const d = oy - y;
        if (Math.abs(d) <= threshold && (!bestY || Math.abs(d) < Math.abs(bestY.d))) bestY = { d, at: oy, o };
      }
  }
  const guides: Guide[] = [];
  const dx = bestX?.d ?? 0;
  const dy = bestY?.d ?? 0;
  if (bestX) guides.push({ axis: "x", at: bestX.at, from: Math.min(box.y + dy, bestX.o.y), to: Math.max(box.y + dy + box.h, bestX.o.y + bestX.o.h) });
  if (bestY) guides.push({ axis: "y", at: bestY.at, from: Math.min(box.x + dx, bestY.o.x), to: Math.max(box.x + dx + box.w, bestY.o.x + bestY.o.w) });
  return { dx, dy, guides };
}

/** Fewer points along a stroke that keep its shape (Ramer–Douglas–Peucker), as flat x, y pairs. */
export function simplify(points: Pt[], tolerance: number): Pt[] {
  if (points.length < 3) return points;
  let worst = 0;
  let at = 0;
  const a = points[0];
  const b = points[points.length - 1];
  for (let i = 1; i < points.length - 1; i++) {
    const d = distToSegment(points[i], a, b);
    if (d > worst) {
      worst = d;
      at = i;
    }
  }
  if (worst <= tolerance) return [a, b];
  return [...simplify(points.slice(0, at + 1), tolerance).slice(0, -1), ...simplify(points.slice(at), tolerance)];
}

/** A smooth path through a pen stroke's points (midpoint quadratic curves). */
export function penPath(points: number[]): string {
  const n = points.length / 2;
  if (n < 2) return `M${points[0]},${points[1]} l0.01,0`;
  if (n === 2) return `M${points[0]},${points[1]} L${points[2]},${points[3]}`;
  let d = `M${points[0].toFixed(1)},${points[1].toFixed(1)}`;
  for (let i = 1; i < n - 1; i++) {
    const x = points[i * 2];
    const y = points[i * 2 + 1];
    const mx = (x + points[i * 2 + 2]) / 2;
    const my = (y + points[i * 2 + 3]) / 2;
    d += ` Q${x.toFixed(1)},${y.toFixed(1)} ${mx.toFixed(1)},${my.toFixed(1)}`;
  }
  return `${d} L${points[(n - 1) * 2].toFixed(1)},${points[(n - 1) * 2 + 1].toFixed(1)}`;
}

/** A shape's outline in a w × h box at the origin. */
export function shapePath(shape: ShapeKind, w: number, h: number): string {
  switch (shape) {
    case "rect":
      return `M0,0 H${w} V${h} H0 Z`;
    case "rounded": {
      const r = Math.min(w, h) * 0.18;
      return `M${r},0 H${w - r} Q${w},0 ${w},${r} V${h - r} Q${w},${h} ${w - r},${h} H${r} Q0,${h} 0,${h - r} V${r} Q0,0 ${r},0 Z`;
    }
    case "ellipse":
      return `M${w / 2},0 A${w / 2},${h / 2} 0 1,1 ${w / 2},${h} A${w / 2},${h / 2} 0 1,1 ${w / 2},0 Z`;
    case "diamond":
      return `M${w / 2},0 L${w},${h / 2} L${w / 2},${h} L0,${h / 2} Z`;
    case "triangle":
      return `M${w / 2},0 L${w},${h} L0,${h} Z`;
    case "hexagon": {
      const k = w * 0.22;
      return `M${k},0 H${w - k} L${w},${h / 2} L${w - k},${h} H${k} L0,${h / 2} Z`;
    }
    case "parallelogram": {
      const k = w * 0.2;
      return `M${k},0 H${w} L${w - k},${h} H0 Z`;
    }
    case "star": {
      const pts = Array.from({ length: 10 }, (_, i) => {
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        const r = i % 2 ? 0.4 : 1;
        return `${(w / 2 + Math.cos(a) * r * (w / 2)).toFixed(1)},${(h / 2 + Math.sin(a) * r * (h / 2) + h * 0.04).toFixed(1)}`;
      });
      return `M${pts.join(" L")} Z`;
    }
    case "cylinder": {
      const e = Math.min(h * 0.18, w * 0.3);
      return `M0,${e / 2} A${w / 2},${e / 2} 0 0,1 ${w},${e / 2} V${h - e / 2} A${w / 2},${e / 2} 0 0,1 0,${h - e / 2} Z M0,${e / 2} A${w / 2},${e / 2} 0 0,0 ${w},${e / 2}`;
    }
    case "speech": {
      const t = h * 0.78;
      return `M0,0 H${w} V${t} H${w * 0.42} L${w * 0.22},${h} L${w * 0.26},${t} H0 Z`;
    }
  }
}
