import { pointInPolygon, wallLength, type Column, type Item, type Opening, type Point, type Wall } from "@/lib/plan/geometry";

/**
 * The geometry the layout checks and the generator share: turned rectangles
 * for furniture, walls and the zones that must stay clear, and a grid laid
 * over a floor to find routes and measure walking distances.
 */

// ---------------------------------------------------------------------------
// Turned rectangles
// ---------------------------------------------------------------------------

/** A rectangle around its middle, turned anticlockwise by `angle` degrees. Width runs along the turned x axis. */
export interface Box {
  c: Point;
  w: number;
  d: number;
  angle: number;
}

const RAD = Math.PI / 180;

export function axes(angle: number): { u: Point; v: Point } {
  const a = angle * RAD;
  return { u: { x: Math.cos(a), y: Math.sin(a) }, v: { x: -Math.sin(a), y: Math.cos(a) } };
}

/** The point at (x, y) in a box's own axes. */
export function local(box: Box, x: number, y: number): Point {
  const { u, v } = axes(box.angle);
  return { x: box.c.x + u.x * x + v.x * y, y: box.c.y + u.y * x + v.y * y };
}

export function corners(box: Box): Point[] {
  const w = box.w / 2;
  const d = box.d / 2;
  return [local(box, -w, -d), local(box, w, -d), local(box, w, d), local(box, -w, d)];
}

export const itemBox = (item: Item): Box => ({ c: item.at, w: item.width, d: item.depth, angle: item.rotation });

export const columnBox = (column: Column, grow = 0): Box => ({
  c: column.at,
  w: column.width + 2 * grow,
  d: (column.round ? column.width : column.depth) + 2 * grow,
  angle: 0,
});

/** A wall's solid parts: the wall less its doors (windows still block the way). */
export function wallBoxes(wall: Wall, openings: Opening[]): Box[] {
  const len = wallLength(wall);
  if (!len) return [];
  const doors = openings
    .filter((o) => o.wallId === wall.id && o.kind === "door")
    .map((o) => [Math.max(0, o.at - o.width / 2), Math.min(len, o.at + o.width / 2)] as const)
    .sort((a, b) => a[0] - b[0]);
  const pieces: [number, number][] = [];
  let from = 0;
  for (const [s, e] of doors) {
    if (s > from) pieces.push([from, s]);
    from = Math.max(from, e);
  }
  if (from < len) pieces.push([from, len]);
  const angle = Math.atan2(wall.b.y - wall.a.y, wall.b.x - wall.a.x) / RAD;
  const ux = (wall.b.x - wall.a.x) / len;
  const uy = (wall.b.y - wall.a.y) / len;
  return pieces
    .filter(([s, e]) => e - s > 1)
    .map(([s, e]) => {
      // A piece at the wall's end runs on by half the thickness, so corners close.
      const from = s === 0 ? -wall.thickness / 2 : s;
      const to = e === len ? len + wall.thickness / 2 : e;
      const mid = (from + to) / 2;
      return { c: { x: wall.a.x + ux * mid, y: wall.a.y + uy * mid }, w: to - from, d: wall.thickness, angle };
    });
}

/** The floor in front of a door, on both sides, that must stay clear. */
export function doorZone(wall: Wall, opening: Opening, clearance: number): Box {
  const len = wallLength(wall) || 1;
  const angle = Math.atan2(wall.b.y - wall.a.y, wall.b.x - wall.a.x) / RAD;
  const c = { x: wall.a.x + ((wall.b.x - wall.a.x) * opening.at) / len, y: wall.a.y + ((wall.b.y - wall.a.y) * opening.at) / len };
  return { c, w: opening.width, d: wall.thickness + 2 * clearance, angle };
}

/** Where a door is, and which ways are into the rooms either side of it. */
export function doorPoint(wall: Wall, opening: Opening): { at: Point; normal: Point } {
  const len = wallLength(wall) || 1;
  const ux = (wall.b.x - wall.a.x) / len;
  const uy = (wall.b.y - wall.a.y) / len;
  return { at: { x: wall.a.x + ux * opening.at, y: wall.a.y + uy * opening.at }, normal: { x: -uy, y: ux } };
}

function project(points: Point[], axis: Point): [number, number] {
  let min = Infinity;
  let max = -Infinity;
  for (const p of points) {
    const d = p.x * axis.x + p.y * axis.y;
    if (d < min) min = d;
    if (d > max) max = d;
  }
  return [min, max];
}

/** How far two boxes overlap, along the axis they overlap least (0 when apart). Touching does not count. */
export function overlapDepth(a: Box, b: Box): number {
  const pa = corners(a);
  const pb = corners(b);
  let least = Infinity;
  for (const box of [a, b]) {
    const { u, v } = axes(box.angle);
    for (const axis of [u, v]) {
      const [a0, a1] = project(pa, axis);
      const [b0, b1] = project(pb, axis);
      const o = Math.min(a1, b1) - Math.max(a0, b0);
      if (o <= 0) return 0;
      if (o < least) least = o;
    }
  }
  return least;
}

/** Boxes that overlap by more than a few millimetres, so items drawn edge to edge are not flagged. */
export function boxesOverlap(a: Box, b: Box, tolerance = 5): boolean {
  return overlapDepth(a, b) > tolerance;
}

export function boxContains(box: Box, p: Point): boolean {
  const { u, v } = axes(box.angle);
  const dx = p.x - box.c.x;
  const dy = p.y - box.c.y;
  return Math.abs(dx * u.x + dy * u.y) <= box.w / 2 && Math.abs(dx * v.x + dy * v.y) <= box.d / 2;
}

// ---------------------------------------------------------------------------
// A grid over the floor
// ---------------------------------------------------------------------------

export const CELL = 100;

/** A grid's own axes: turned so a room's long side runs along x. */
export interface Frame {
  origin: Point;
  /** Degrees, anticlockwise. */
  angle: number;
}

export function toLocal(frame: Frame, p: Point): Point {
  const a = -frame.angle * RAD;
  const dx = p.x - frame.origin.x;
  const dy = p.y - frame.origin.y;
  return { x: dx * Math.cos(a) - dy * Math.sin(a), y: dx * Math.sin(a) + dy * Math.cos(a) };
}

export function toWorld(frame: Frame, p: Point): Point {
  const a = frame.angle * RAD;
  return {
    x: frame.origin.x + p.x * Math.cos(a) - p.y * Math.sin(a),
    y: frame.origin.y + p.x * Math.sin(a) + p.y * Math.cos(a),
  };
}

/** What a grid cell holds, as bits. */
export const INSIDE = 1;
export const SOLID = 2;
export const FURNITURE = 4;
export const ROUTE = 8;
export const DOOR = 16;

export class Grid {
  readonly cols: number;
  readonly rows: number;
  readonly cells: Uint8Array;

  constructor(
    readonly frame: Frame,
    /** The local corner of cell (0, 0). */
    readonly x0: number,
    readonly y0: number,
    width: number,
    height: number,
    readonly cell = CELL
  ) {
    this.cols = Math.max(1, Math.ceil(width / cell));
    this.rows = Math.max(1, Math.ceil(height / cell));
    this.cells = new Uint8Array(this.cols * this.rows);
  }

  /** A grid covering these world points, in the frame given, with a margin. */
  static around(frame: Frame, points: Point[], margin = 2 * CELL, cell = CELL): Grid {
    const loc = points.map((p) => toLocal(frame, p));
    const minX = Math.min(...loc.map((p) => p.x)) - margin;
    const minY = Math.min(...loc.map((p) => p.y)) - margin;
    const maxX = Math.max(...loc.map((p) => p.x)) + margin;
    const maxY = Math.max(...loc.map((p) => p.y)) + margin;
    return new Grid(frame, minX, minY, maxX - minX, maxY - minY, cell);
  }

  index(i: number, j: number): number {
    return j * this.cols + i;
  }

  /** The middle of cell (i, j), in the grid's own axes. */
  centre(i: number, j: number): Point {
    return { x: this.x0 + (i + 0.5) * this.cell, y: this.y0 + (j + 0.5) * this.cell };
  }

  world(i: number, j: number): Point {
    return toWorld(this.frame, this.centre(i, j));
  }

  /** The cell under a world point, or -1 off the grid. */
  at(p: Point): number {
    const q = toLocal(this.frame, p);
    const i = Math.floor((q.x - this.x0) / this.cell);
    const j = Math.floor((q.y - this.y0) / this.cell);
    return i < 0 || j < 0 || i >= this.cols || j >= this.rows ? -1 : this.index(i, j);
  }

  /** Calls back for each cell whose middle falls in the area, given by its corners in the world. */
  each(points: Point[], test: (q: Point) => boolean, fn: (k: number) => void) {
    const loc = points.map((p) => toLocal(this.frame, p));
    const i0 = Math.max(0, Math.floor((Math.min(...loc.map((p) => p.x)) - this.x0) / this.cell));
    const i1 = Math.min(this.cols - 1, Math.floor((Math.max(...loc.map((p) => p.x)) - this.x0) / this.cell));
    const j0 = Math.max(0, Math.floor((Math.min(...loc.map((p) => p.y)) - this.y0) / this.cell));
    const j1 = Math.min(this.rows - 1, Math.floor((Math.max(...loc.map((p) => p.y)) - this.y0) / this.cell));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        if (test(this.world(i, j))) fn(this.index(i, j));
      }
    }
  }

  /** Marks the cells under a box. A box thinner than a cell (a 90 mm partition) still marks a full line of cells, so nothing leaks through it. */
  markBox(box: Box, flag: number) {
    const min = this.cell * 1.01;
    const b = box.w < min || box.d < min ? { ...box, w: Math.max(box.w, min), d: Math.max(box.d, min) } : box;
    this.each(corners(b), (q) => boxContains(b, q), (k) => (this.cells[k] |= flag));
  }

  markPolygon(points: Point[], flag: number) {
    this.each(points, (q) => pointInPolygon(q, points), (k) => (this.cells[k] |= flag));
  }

  /** The cells a box covers. */
  cellsOf(box: Box): number[] {
    const out: number[] = [];
    this.each(corners(box), (q) => boxContains(box, q), (k) => out.push(k));
    return out;
  }

  /**
   * For each cell, how far its middle is from the nearest cell that is not
   * open, in mm (a two-pass chamfer distance, close enough at this cell size).
   */
  clearance(open: (flags: number) => boolean): Float32Array {
    const { cols, rows, cell } = this;
    const big = 1e9;
    const d = new Float32Array(cols * rows);
    for (let k = 0; k < d.length; k++) d[k] = open(this.cells[k]) ? big : 0;
    const diag = cell * Math.SQRT2;
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const k = j * cols + i;
        if (!d[k]) continue;
        let v = d[k];
        // Cells off the grid count as closed, so the edge of the grid is a wall.
        v = Math.min(v, i > 0 ? d[k - 1] + cell : cell / 2);
        v = Math.min(v, j > 0 ? d[k - cols] + cell : cell / 2);
        if (i > 0 && j > 0) v = Math.min(v, d[k - cols - 1] + diag);
        if (i < cols - 1 && j > 0) v = Math.min(v, d[k - cols + 1] + diag);
        d[k] = v;
      }
    }
    for (let j = rows - 1; j >= 0; j--) {
      for (let i = cols - 1; i >= 0; i--) {
        const k = j * cols + i;
        if (!d[k]) continue;
        let v = d[k];
        v = Math.min(v, i < cols - 1 ? d[k + 1] + cell : cell / 2);
        v = Math.min(v, j < rows - 1 ? d[k + cols] + cell : cell / 2);
        if (i < cols - 1 && j < rows - 1) v = Math.min(v, d[k + cols + 1] + diag);
        if (i > 0 && j < rows - 1) v = Math.min(v, d[k + cols - 1] + diag);
        d[k] = v;
      }
    }
    // The chamfer measures to the middle of the closed cell; its edge is half a cell nearer.
    for (let k = 0; k < d.length; k++) if (d[k]) d[k] = Math.max(0, d[k] - cell / 2);
    return d;
  }

  /**
   * Walking distance from the seed cells to every cell that can be walked
   * (Dijkstra over the eight neighbours). Cells that cannot be reached stay
   * at Infinity.
   */
  walk(seeds: number[], walkable: (k: number) => boolean): Float64Array {
    const { cols, rows, cell } = this;
    const dist = new Float64Array(cols * rows).fill(Infinity);
    const heap = new MinHeap();
    for (const s of seeds) {
      if (s < 0 || dist[s] === 0) continue;
      dist[s] = 0;
      heap.push(0, s);
    }
    const diag = cell * Math.SQRT2;
    const steps: [number, number, number][] = [
      [1, 0, cell], [-1, 0, cell], [0, 1, cell], [0, -1, cell],
      [1, 1, diag], [1, -1, diag], [-1, 1, diag], [-1, -1, diag],
    ];
    while (heap.size) {
      const [dk, k] = heap.pop();
      if (dk > dist[k]) continue;
      const i = k % cols;
      const j = (k - i) / cols;
      for (const [di, dj, cost] of steps) {
        const ni = i + di;
        const nj = j + dj;
        if (ni < 0 || nj < 0 || ni >= cols || nj >= rows) continue;
        const n = nj * cols + ni;
        if (!walkable(n)) continue;
        // No cutting a corner between two closed cells.
        if (di && dj && (!walkable(j * cols + ni) || !walkable(nj * cols + i))) continue;
        const nd = dk + cost;
        if (nd < dist[n]) {
          dist[n] = nd;
          heap.push(nd, n);
        }
      }
    }
    return dist;
  }
}

class MinHeap {
  private keys: number[] = [];
  private values: number[] = [];

  get size() {
    return this.keys.length;
  }

  push(key: number, value: number) {
    const { keys, values } = this;
    let i = keys.length;
    keys.push(key);
    values.push(value);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (keys[p] <= key) break;
      keys[i] = keys[p];
      values[i] = values[p];
      i = p;
    }
    keys[i] = key;
    values[i] = value;
  }

  pop(): [number, number] {
    const { keys, values } = this;
    const top: [number, number] = [keys[0], values[0]];
    const lastKey = keys.pop()!;
    const lastValue = values.pop()!;
    const n = keys.length;
    if (n) {
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        if (l >= n) break;
        const r = l + 1;
        const c = r < n && keys[r] < keys[l] ? r : l;
        if (keys[c] >= lastKey) break;
        keys[i] = keys[c];
        values[i] = values[c];
        i = c;
      }
      keys[i] = lastKey;
      values[i] = lastValue;
    }
    return top;
  }
}
