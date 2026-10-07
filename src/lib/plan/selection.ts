import {
  distance,
  finite,
  itemName,
  mm,
  newId,
  onLevel,
  openingsFit,
  pointAlong,
  pointInPolygon,
  removeItem,
  samePoint,
  wallLength,
  type Bounds,
  type Column,
  type Dimension,
  type EditResult,
  type Item,
  type Note,
  type Opening,
  type Plan,
  type PlanItem,
  type PlanItemKind,
  type Point,
  type Room,
  type Wall,
} from "./geometry";
import { checked, moveBy, rotateItem } from "./elements";
import { libraryItem } from "./library";

/**
 * Working on several things at once: what is selected, finding what a
 * selection box takes in, and moving, copying, turning, mirroring, lining up
 * and removing a selection. These are Revit's Modify tools. Each edit returns
 * the new plan and one line for the corrections log, like every other edit,
 * so the assistant can make the same edits a person makes.
 *
 * A selection is a list of `{ kind, id }`, all on one floor.
 */

export type Selection = PlanItem[];

const fail = (error: string): EditResult => ({ ok: false, error });
const same = (plan: Plan): EditResult => ({ ok: true, plan, summary: "" });

export const keyOf = (t: PlanItem) => `${t.kind}:${t.id}`;

export function isSelected(selection: Selection, t: PlanItem): boolean {
  return selection.some((s) => s.kind === t.kind && s.id === t.id);
}

/** Adds a thing to the selection, or takes it out when it is already in. */
export function toggle(selection: Selection, t: PlanItem): Selection {
  return isSelected(selection, t) ? selection.filter((s) => !(s.kind === t.kind && s.id === t.id)) : [...selection, t];
}

/** The selection with duplicates dropped, keeping the first of each. */
export function unique(selection: Selection): Selection {
  const seen = new Set<string>();
  return selection.filter((t) => {
    const k = keyOf(t);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Whether a thing is still on the plan. */
export function exists(plan: Plan, t: PlanItem): boolean {
  const lists: Record<PlanItemKind, { id: string }[]> = {
    wall: plan.walls,
    opening: plan.openings,
    column: plan.columns,
    room: plan.rooms,
    item: plan.items,
    note: plan.notes,
    dimension: plan.dimensions,
  };
  return lists[t.kind].some((x) => x.id === t.id);
}

// ---------------------------------------------------------------------------
// Saying what is selected
// ---------------------------------------------------------------------------

const KIND_NAME: Record<Exclude<PlanItemKind, "item" | "opening">, string> = {
  wall: "Wall",
  column: "Column",
  room: "Room",
  note: "Note",
  dimension: "Dimension",
};

function nameOf(plan: Plan, t: PlanItem): string {
  if (t.kind === "item") {
    const item = plan.items.find((i) => i.id === t.id);
    return item ? libraryItem(item.type).name : "Item";
  }
  if (t.kind === "opening") return plan.openings.find((o) => o.id === t.id)?.kind === "window" ? "Window" : "Door";
  if (t.kind === "wall") return plan.walls.find((w) => w.id === t.id)?.kind === "partition" ? "Partition" : "Wall";
  return KIND_NAME[t.kind];
}

/** A selection in words, e.g. "Desk D12", or "4 × Desk, 2 × Wall". */
export function describeSelection(plan: Plan, selection: Selection): string {
  const live = selection.filter((t) => exists(plan, t));
  if (!live.length) return "Nothing";
  if (live.length === 1) {
    const t = live[0];
    if (t.kind === "item") return itemName(plan.items.find((i) => i.id === t.id)!);
    if (t.kind === "room") return plan.rooms.find((r) => r.id === t.id)!.name;
    return nameOf(plan, t);
  }
  const counts = new Map<string, number>();
  for (const t of live) counts.set(nameOf(plan, t), (counts.get(nameOf(plan, t)) ?? 0) + 1);
  return [...counts]
    .sort((a, b) => b[1] - a[1])
    .map(([name, n]) => `${n} × ${name}`)
    .join(", ");
}

// ---------------------------------------------------------------------------
// Where things are
// ---------------------------------------------------------------------------

function itemCorners(at: Point, width: number, depth: number, rotation: number): Point[] {
  const a = (rotation * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ].map(([sx, sy]) => {
    const x = (sx * width) / 2;
    const y = (sy * depth) / 2;
    return { x: at.x + x * c - y * s, y: at.y + x * s + y * c };
  });
}

/** The outline a thing covers on the plan, and whether it closes. Null when it is not on the plan. */
export function outlineOf(plan: Plan, t: PlanItem): { points: Point[]; closed: boolean } | null {
  switch (t.kind) {
    case "wall": {
      const w = plan.walls.find((x) => x.id === t.id);
      return w ? { points: [w.a, w.b], closed: false } : null;
    }
    case "opening": {
      const o = plan.openings.find((x) => x.id === t.id);
      const w = o && plan.walls.find((x) => x.id === o.wallId);
      return o && w ? { points: [pointAlong(w, o.at - o.width / 2), pointAlong(w, o.at + o.width / 2)], closed: false } : null;
    }
    case "column": {
      const c = plan.columns.find((x) => x.id === t.id);
      return c ? { points: itemCorners(c.at, c.width, c.depth, 0), closed: true } : null;
    }
    case "room": {
      const r = plan.rooms.find((x) => x.id === t.id);
      return r ? { points: r.points, closed: true } : null;
    }
    case "item": {
      const i = plan.items.find((x) => x.id === t.id);
      return i ? { points: itemCorners(i.at, i.width, i.depth, i.rotation), closed: true } : null;
    }
    case "note": {
      const n = plan.notes.find((x) => x.id === t.id);
      return n ? { points: [n.at], closed: false } : null;
    }
    case "dimension": {
      const d = plan.dimensions.find((x) => x.id === t.id);
      if (!d) return null;
      const len = distance(d.a, d.b) || 1;
      const n = { x: (-(d.b.y - d.a.y) / len) * d.offset, y: ((d.b.x - d.a.x) / len) * d.offset };
      return { points: [d.a, d.b, { x: d.b.x + n.x, y: d.b.y + n.y }, { x: d.a.x + n.x, y: d.a.y + n.y }], closed: true };
    }
  }
}

function boundsOfPoints(points: Point[]): Bounds | null {
  if (!points.length) return null;
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
}

/** The box round everything selected. */
export function selectionBounds(plan: Plan, selection: Selection): Bounds | null {
  return boundsOfPoints(selection.flatMap((t) => outlineOf(plan, t)?.points ?? []));
}

const centreOf = (b: Bounds): Point => ({ x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 });

const inside = (p: Point, r: Bounds) => p.x >= r.minX && p.x <= r.maxX && p.y >= r.minY && p.y <= r.maxY;

function segmentsMeet(p1: Point, p2: Point, p3: Point, p4: Point): boolean {
  const d = (a: Point, b: Point, c: Point) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const d1 = d(p3, p4, p1);
  const d2 = d(p3, p4, p2);
  const d3 = d(p1, p2, p3);
  const d4 = d(p1, p2, p4);
  return d1 * d2 <= 0 && d3 * d4 <= 0 && !(d1 === 0 && d2 === 0 && d3 === 0 && d4 === 0);
}

function touches(points: Point[], closed: boolean, r: Bounds): boolean {
  if (points.some((p) => inside(p, r))) return true;
  const corners = [
    { x: r.minX, y: r.minY },
    { x: r.maxX, y: r.minY },
    { x: r.maxX, y: r.maxY },
    { x: r.minX, y: r.maxY },
  ];
  const edges = closed ? points.length : points.length - 1;
  for (let i = 0; i < edges; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    for (let k = 0; k < 4; k++) if (segmentsMeet(a, b, corners[k], corners[(k + 1) % 4])) return true;
  }
  // A small box dropped inside furniture or a column takes it; one inside a room does not, or every box would take the room.
  return closed && points.length === 4 && pointInPolygon(centreOf(r), points);
}

/** Everything on one floor, optionally only some kinds. */
export function everythingOn(plan: Plan, levelId: string, kinds?: ReadonlySet<PlanItemKind>): Selection {
  const level = onLevel(plan, levelId);
  const all: Selection = [
    ...level.rooms.map((x) => ({ kind: "room" as const, id: x.id })),
    ...level.walls.map((x) => ({ kind: "wall" as const, id: x.id })),
    ...level.openings.map((x) => ({ kind: "opening" as const, id: x.id })),
    ...level.columns.map((x) => ({ kind: "column" as const, id: x.id })),
    ...level.items.map((x) => ({ kind: "item" as const, id: x.id })),
    ...level.notes.map((x) => ({ kind: "note" as const, id: x.id })),
    ...level.dimensions.map((x) => ({ kind: "dimension" as const, id: x.id })),
  ];
  return kinds ? all.filter((t) => kinds.has(t.kind)) : all;
}

/**
 * What a selection box takes in, the way Revit and AutoCAD do it: a window
 * (dragged left to right) takes only what is wholly inside; a crossing box
 * (dragged right to left) also takes whatever it touches.
 */
export function inBox(plan: Plan, levelId: string, box: Bounds, crossing: boolean, kinds?: ReadonlySet<PlanItemKind>): Selection {
  return everythingOn(plan, levelId, kinds).filter((t) => {
    const outline = outlineOf(plan, t);
    if (!outline) return false;
    return crossing ? touches(outline.points, outline.closed, box) : outline.points.every((p) => inside(p, box));
  });
}

// ---------------------------------------------------------------------------
// Moving, turning and mirroring together
// ---------------------------------------------------------------------------

interface Change {
  /** Degrees anticlockwise, for turning. */
  turn?: number;
  /** The direction of the mirror line in degrees, for mirroring. */
  mirror?: number;
}

/**
 * Applies one transformation to everything selected. The ends of selected
 * walls and the corners of selected rooms move, and so does every other wall
 * end or room corner on that point, so walls joined to the selection stretch
 * to stay joined, as they do in Revit.
 */
function transform(plan: Plan, selection: Selection, f: (p: Point) => Point, change: Change = {}): Plan {
  const picked = (kind: PlanItemKind) => new Set(selection.filter((t) => t.kind === kind).map((t) => t.id));
  const walls = picked("wall");
  const rooms = picked("room");
  const items = picked("item");
  const columns = picked("column");
  const notes = picked("note");
  const dims = picked("dimension");
  const levelId = selection.map((t) => levelOfThing(plan, t)).find(Boolean);

  const moving: Point[] = [];
  for (const w of plan.walls) if (walls.has(w.id)) moving.push(w.a, w.b);
  for (const r of plan.rooms) if (rooms.has(r.id)) moving.push(...r.points);
  const moves = (p: Point) => moving.some((q) => samePoint(p, q));
  const at = (p: Point) => (moves(p) ? f(p) : p);

  const nextWalls: Wall[] = plan.walls.map((w) => (w.levelId === levelId ? { ...w, a: at(w.a), b: at(w.b) } : w));
  // Mirroring a wall turns it inside out, so its doors open to the other side to stay as they were drawn.
  const flipped = new Set(
    change.mirror == null ? [] : plan.walls.filter((w) => w.levelId === levelId && moves(w.a) && moves(w.b)).map((w) => w.id)
  );
  const turnBy = (r: number) => {
    let out = r;
    if (change.turn != null) out = r + change.turn;
    if (change.mirror != null) out = 2 * change.mirror - r;
    return Math.round((((out % 360) + 360) % 360) * 10) / 10 % 360;
  };
  const quarter = change.turn != null && Math.abs(change.turn % 180) === 90;

  return {
    ...plan,
    walls: nextWalls,
    openings: plan.openings.map((o): Opening => (flipped.has(o.wallId) ? { ...o, side: (o.side ?? 1) === 1 ? -1 : 1 } : o)),
    rooms: plan.rooms.map((r): Room =>
      r.levelId !== levelId ? r : rooms.has(r.id) ? { ...r, points: r.points.map(f) } : { ...r, points: r.points.map(at) }
    ),
    items: plan.items.map((i): Item => (items.has(i.id) ? { ...i, at: f(i.at), rotation: turnBy(i.rotation) } : i)),
    columns: plan.columns.map((c): Column =>
      columns.has(c.id) ? { ...c, at: f(c.at), ...(quarter && !c.round ? { width: c.depth, depth: c.width } : {}) } : c
    ),
    notes: plan.notes.map((n): Note => (notes.has(n.id) ? { ...n, at: f(n.at) } : n)),
    dimensions: plan.dimensions.map((d): Dimension =>
      dims.has(d.id) ? { ...d, a: f(d.a), b: f(d.b), offset: change.mirror != null ? -d.offset : d.offset } : d
    ),
  };
}

function levelOfThing(plan: Plan, t: PlanItem): string | undefined {
  if (t.kind === "opening") {
    const o = plan.openings.find((x) => x.id === t.id);
    return o && plan.walls.find((w) => w.id === o.wallId)?.levelId;
  }
  const lists: Record<Exclude<PlanItemKind, "opening">, { id: string; levelId: string }[]> = {
    wall: plan.walls,
    column: plan.columns,
    room: plan.rooms,
    item: plan.items,
    note: plan.notes,
    dimension: plan.dimensions,
  };
  return lists[t.kind].find((x) => x.id === t.id)?.levelId;
}

function live(plan: Plan, selection: Selection): Selection {
  return unique(selection).filter((t) => exists(plan, t));
}

/**
 * Moves everything selected by `delta`. One thing on its own moves as it does
 * when dragged (a wall square to itself, a door along its wall); several move
 * together. A door or window selected without its wall slides along the wall.
 */
export function moveMany(plan: Plan, selection: Selection, delta: Point): EditResult {
  const targets = live(plan, selection);
  if (!targets.length) return fail("Select something to move first.");
  if (targets.length === 1) return moveBy(plan, targets[0], delta);
  if (!finite(delta.x, delta.y)) return fail("That point is off the plan.");
  if (Math.hypot(delta.x, delta.y) < 0.5) return same(plan);
  let next = transform(plan, targets, (p) => ({ x: p.x + delta.x, y: p.y + delta.y }));
  const carried = new Set(targets.filter((t) => t.kind === "wall").map((t) => t.id));
  for (const t of targets) {
    if (t.kind !== "opening") continue;
    const o = next.openings.find((x) => x.id === t.id);
    if (!o || carried.has(o.wallId)) continue;
    const slid = moveBy(next, t, delta);
    if (!slid.ok) return slid;
    next = slid.plan;
  }
  return checked(next, `${describeSelection(plan, targets)} moved ${mm(Math.hypot(delta.x, delta.y))}`);
}

/** Turns what is selected about the middle of the selection, or about `about`. */
export function rotateMany(plan: Plan, selection: Selection, degrees: number, about?: Point): EditResult {
  const targets = live(plan, selection).filter((t) => t.kind !== "opening");
  if (!targets.length) return fail("Select something to turn first. Doors and windows turn with their walls.");
  if (!Number.isFinite(degrees)) return fail("Type the angle in degrees.");
  if (Math.abs(degrees % 360) < 0.05) return same(plan);
  if (targets.length === 1 && !about && (targets[0].kind === "item" || targets[0].kind === "column")) return rotateItem(plan, targets[0], degrees);
  const b = selectionBounds(plan, targets)!;
  const c = about ?? centreOf(b);
  const a = (degrees * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const f = (p: Point) => ({ x: c.x + (p.x - c.x) * cos - (p.y - c.y) * sin, y: c.y + (p.x - c.x) * sin + (p.y - c.y) * cos });
  return checked(transform(plan, targets, f, { turn: degrees }), `${describeSelection(plan, targets)} turned ${Math.round(degrees * 10) / 10}°`);
}

/**
 * Mirrors what is selected about a line through the middle of the selection:
 * "left-right" flips it across an upright line, "up-down" across a level one.
 * Doors keep opening the way they were drawn relative to their walls.
 */
export function mirrorMany(plan: Plan, selection: Selection, axis: "left-right" | "up-down", about?: Point): EditResult {
  const targets = live(plan, selection).filter((t) => t.kind !== "opening");
  if (!targets.length) return fail("Select something to mirror first. Doors and windows mirror with their walls.");
  const c = about ?? centreOf(selectionBounds(plan, targets)!);
  const f = axis === "left-right" ? (p: Point) => ({ x: 2 * c.x - p.x, y: p.y }) : (p: Point) => ({ x: p.x, y: 2 * c.y - p.y });
  return checked(
    transform(plan, targets, f, { mirror: axis === "left-right" ? 90 : 0 }),
    `${describeSelection(plan, targets)} mirrored ${axis === "left-right" ? "left to right" : "top to bottom"}`
  );
}

// ---------------------------------------------------------------------------
// Lining up
// ---------------------------------------------------------------------------

export type AlignEdge = "left" | "centre" | "right" | "top" | "middle" | "bottom";

const LOOSE = new Set<PlanItemKind>(["item", "column", "note"]);

function shiftOne(plan: Plan, t: PlanItem, d: Point): Plan {
  const s = (p: Point) => ({ x: p.x + d.x, y: p.y + d.y });
  if (t.kind === "item") return { ...plan, items: plan.items.map((i) => (i.id === t.id ? { ...i, at: s(i.at) } : i)) };
  if (t.kind === "column") return { ...plan, columns: plan.columns.map((c) => (c.id === t.id ? { ...c, at: s(c.at) } : c)) };
  if (t.kind === "note") return { ...plan, notes: plan.notes.map((n) => (n.id === t.id ? { ...n, at: s(n.at) } : n)) };
  return plan;
}

const EDGE_WORDS: Record<AlignEdge, string> = {
  left: "on their left edges",
  centre: "on their centres, one above the other",
  right: "on their right edges",
  top: "on their top edges",
  middle: "on their middles, side by side",
  bottom: "on their bottom edges",
};

/** Lines up furniture, columns and notes on one edge or centre of the box round them. */
export function alignMany(plan: Plan, selection: Selection, edge: AlignEdge): EditResult {
  const targets = live(plan, selection).filter((t) => LOOSE.has(t.kind));
  if (targets.length < 2) return fail("Select two or more pieces of furniture, columns or notes to line up.");
  const all = selectionBounds(plan, targets)!;
  let next = plan;
  for (const t of targets) {
    const b = boundsOfPoints(outlineOf(plan, t)!.points)!;
    const d = { x: 0, y: 0 };
    if (edge === "left") d.x = all.minX - b.minX;
    if (edge === "right") d.x = all.maxX - b.maxX;
    if (edge === "centre") d.x = (all.minX + all.maxX) / 2 - (b.minX + b.maxX) / 2;
    if (edge === "bottom") d.y = all.minY - b.minY;
    if (edge === "top") d.y = all.maxY - b.maxY;
    if (edge === "middle") d.y = (all.minY + all.maxY) / 2 - (b.minY + b.maxY) / 2;
    if (Math.abs(d.x) >= 0.5 || Math.abs(d.y) >= 0.5) next = shiftOne(next, t, { x: Math.round(d.x), y: Math.round(d.y) });
  }
  if (next === plan) return same(plan);
  return { ok: true, plan: next, summary: `${describeSelection(plan, targets)} lined up ${EDGE_WORDS[edge]}` };
}

/** Spaces furniture, columns and notes evenly between the first and the last, with equal gaps. */
export function distributeMany(plan: Plan, selection: Selection, axis: "across" | "up"): EditResult {
  const targets = live(plan, selection).filter((t) => LOOSE.has(t.kind));
  if (targets.length < 3) return fail("Select three or more pieces of furniture, columns or notes to space out.");
  const lo = axis === "across" ? "minX" : "minY";
  const hi = axis === "across" ? "maxX" : "maxY";
  const boxes = targets
    .map((t) => ({ t, b: boundsOfPoints(outlineOf(plan, t)!.points)! }))
    .sort((p, q) => p.b[lo] + p.b[hi] - (q.b[lo] + q.b[hi]));
  const span = boxes[boxes.length - 1].b[hi] - boxes[0].b[lo];
  const sizes = boxes.reduce((s, x) => s + (x.b[hi] - x.b[lo]), 0);
  const gap = (span - sizes) / (boxes.length - 1);
  let next = plan;
  let cursor = boxes[0].b[lo];
  for (const { t, b } of boxes) {
    const d = Math.round(cursor - b[lo]);
    if (Math.abs(d) >= 0.5) next = shiftOne(next, t, axis === "across" ? { x: d, y: 0 } : { x: 0, y: d });
    cursor += b[hi] - b[lo] + gap;
  }
  if (next === plan) return same(plan);
  return {
    ok: true,
    plan: next,
    summary: `${describeSelection(plan, targets)} spaced evenly ${axis === "across" ? "across" : "up and down"}, ${mm(Math.max(0, gap))} apart`,
  };
}

// ---------------------------------------------------------------------------
// Copying, pasting and removing
// ---------------------------------------------------------------------------

/** Things taken off a plan to put down again, here or on another floor. */
export interface Clip {
  walls: Wall[];
  openings: Opening[];
  columns: Column[];
  rooms: Room[];
  items: Item[];
  notes: Note[];
  dimensions: Dimension[];
}

export function clipCount(clip: Clip): number {
  return clip.walls.length + clip.openings.length + clip.columns.length + clip.rooms.length + clip.items.length + clip.notes.length + clip.dimensions.length;
}

/** A copy of what is selected. Doors and windows come along with their walls, and with nothing else. */
export function copyOut(plan: Plan, selection: Selection): Clip {
  const ids = (kind: PlanItemKind) => new Set(selection.filter((t) => t.kind === kind).map((t) => t.id));
  const walls = ids("wall");
  const pick = <T extends { id: string }>(list: T[], kind: PlanItemKind) => list.filter((x) => ids(kind).has(x.id)).map((x) => structuredClone(x));
  return {
    walls: pick(plan.walls, "wall"),
    // A selected wall takes its doors and windows along, selected or not.
    openings: plan.openings.filter((o) => walls.has(o.wallId)).map((o) => structuredClone(o)),
    columns: pick(plan.columns, "column"),
    rooms: pick(plan.rooms, "room"),
    items: pick(plan.items, "item"),
    notes: pick(plan.notes, "note"),
    dimensions: pick(plan.dimensions, "dimension"),
  };
}

/** The box round a clip. */
export function clipBounds(clip: Clip): Bounds | null {
  return boundsOfPoints([
    ...clip.walls.flatMap((w) => [w.a, w.b]),
    ...clip.rooms.flatMap((r) => r.points),
    ...clip.columns.flatMap((c) => itemCorners(c.at, c.width, c.depth, 0)),
    ...clip.items.flatMap((i) => itemCorners(i.at, i.width, i.depth, i.rotation)),
    ...clip.notes.map((n) => n.at),
    ...clip.dimensions.flatMap((d) => [d.a, d.b]),
  ]);
}

/** Puts a clip down on a floor, moved by `delta`, as new things; `created` lists them so they can be selected. */
export function pasteIn(plan: Plan, clip: Clip, levelId: string, delta: Point, verb = "pasted"): EditResult {
  if (!clipCount(clip)) return fail("There is nothing to put down. Doors and windows are copied with their walls.");
  if (!plan.levels.some((l) => l.id === levelId)) return fail("That floor is no longer on the plan.");
  if (!finite(delta.x, delta.y)) return fail("That point is off the plan.");
  const s = (p: Point) => ({ x: p.x + delta.x, y: p.y + delta.y });
  const wallIds = new Map<string, string>();
  const created: Selection = [];
  const made = <T extends { id: string }>(kind: PlanItemKind, x: T): T => {
    created.push({ kind, id: x.id });
    return x;
  };
  const walls = clip.walls.map((w) => {
    const id = newId();
    wallIds.set(w.id, id);
    return made("wall", { ...w, id, levelId, a: s(w.a), b: s(w.b) });
  });
  const openings = clip.openings.filter((o) => wallIds.has(o.wallId)).map((o) => made("opening", { ...o, id: newId(), wallId: wallIds.get(o.wallId)! }));
  const next: Plan = {
    ...plan,
    walls: [...plan.walls, ...walls],
    openings: [...plan.openings, ...openings],
    columns: [...plan.columns, ...clip.columns.map((c) => made("column", { ...c, id: newId(), levelId, at: s(c.at) }))],
    rooms: [...plan.rooms, ...clip.rooms.map((r) => made("room", { ...r, id: newId(), levelId, points: r.points.map(s) }))],
    items: [...plan.items, ...clip.items.map((i) => made("item", { ...i, id: newId(), levelId, at: s(i.at) }))],
    notes: [...plan.notes, ...clip.notes.map((n) => made("note", { ...n, id: newId(), levelId, at: s(n.at) }))],
    dimensions: [...plan.dimensions, ...clip.dimensions.map((d) => made("dimension", { ...d, id: newId(), levelId, a: s(d.a), b: s(d.b) }))],
  };
  for (const w of walls) {
    const problem = openingsFit(next, w.id, wallLength(w));
    if (problem) return fail(problem);
  }
  // Selecting the copies picks the walls, rooms and loose things; their doors and windows come with the walls.
  const selectable = created.filter((t) => t.kind !== "opening");
  return { ok: true, plan: next, summary: `${describeSelection(next, selectable)} ${verb}`, id: selectable[0]?.id, created: selectable };
}

/** Copies what is selected, set off by `delta`, the way Ctrl+D or an Alt+drag does. */
export function duplicateMany(plan: Plan, selection: Selection, delta: Point = { x: 500, y: -500 }): EditResult {
  const targets = live(plan, selection);
  const level = targets.map((t) => levelOfThing(plan, t)).find(Boolean);
  if (!targets.length || !level) return fail("Select something to copy first.");
  return pasteIn(plan, copyOut(plan, targets), level, delta, "copied");
}

/** Removes everything selected. Removing a wall takes its doors and windows with it. */
export function removeMany(plan: Plan, selection: Selection): EditResult {
  const targets = live(plan, selection);
  if (!targets.length) return fail("Select something to remove first.");
  if (targets.length === 1) return removeItem(plan, targets[0]);
  const words = describeSelection(plan, targets);
  let next = plan;
  for (const t of targets) {
    if (!exists(next, t)) continue;
    const r = removeItem(next, t);
    if (!r.ok) return r;
    next = r.plan;
  }
  return { ok: true, plan: next, summary: `${words} removed` };
}
