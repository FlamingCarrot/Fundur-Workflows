import {
  LIMITS,
  addRoom,
  brokenRoom,
  distance,
  finite,
  itemName,
  levelOf,
  m2,
  mm,
  movePoint,
  newId,
  openingsFit,
  pointAlong,
  pointInPolygon,
  polygonArea,
  samePoint,
  wallLength,
  type EditResult,
  type Item,
  type Level,
  type Opening,
  type Plan,
  type PlanItem,
  type Point,
  type Underlay,
  type Wall,
  type WallKind,
} from "./geometry";
import { libraryItem } from "./library";

/**
 * The edits beyond walls and rooms: furniture, notes, dimension lines, floors,
 * the traced-over image, moving and turning things, and finding a room's
 * outline from the walls around a point. Each returns the new plan and a line
 * for the corrections log, or the reason it cannot be done.
 */

const fail = (error: string): EditResult => ({ ok: false, error });
const same = (plan: Plan): EditResult => ({ ok: true, plan, summary: "" });

function sizeProblem(width: number, depth: number): string | null {
  if (![width, depth].every((v) => Number.isFinite(v) && v >= 10 && v <= LIMITS.maxWall)) {
    return `Its sides must be between ${mm(10)} and ${mm(LIMITS.maxWall)}.`;
  }
  return null;
}

/** Turns an angle into 0 to 360, rounded to a tenth of a degree. */
function normalAngle(degrees: number): number {
  const a = ((degrees % 360) + 360) % 360;
  return Math.round(a * 10) / 10 % 360;
}

// ---------------------------------------------------------------------------
// Furniture and fittings
// ---------------------------------------------------------------------------

export function addItem(plan: Plan, type: string, at: Point, levelId: string = plan.levels[0].id, rotation = 0): EditResult {
  if (!finite(at.x, at.y)) return fail("That point is off the plan.");
  const kind = libraryItem(type);
  const item: Item = { id: newId(), levelId, type: kind.type, at: { ...at }, width: kind.width, depth: kind.depth, rotation: normalAngle(rotation) };
  return { ok: true, id: item.id, plan: { ...plan, items: [...plan.items, item] }, summary: `${kind.name} placed` };
}

export function updateItem(plan: Plan, itemId: string, patch: Partial<Pick<Item, "width" | "depth" | "rotation" | "label">>): EditResult {
  const item = plan.items.find((i) => i.id === itemId);
  if (!item) return fail("That is no longer on the plan.");
  const label = patch.label != null ? patch.label.trim().slice(0, 120) : item.label;
  const updated: Item = { ...item, ...patch, rotation: normalAngle(patch.rotation ?? item.rotation) };
  if (label) updated.label = label;
  else delete updated.label;
  const problem = sizeProblem(updated.width, updated.depth);
  if (problem) return fail(problem);
  const parts: string[] = [];
  if (Math.abs(updated.width - item.width) >= 0.5 || Math.abs(updated.depth - item.depth) >= 0.5) {
    parts.push(`now ${mm(updated.width)} by ${mm(updated.depth)}`);
  }
  if (updated.rotation !== item.rotation) parts.push(`turned to ${updated.rotation}°`);
  if ((label ?? "") !== (item.label ?? "")) parts.push(label ? `labelled "${label}"` : "label removed");
  if (!parts.length) return same(plan);
  return {
    ok: true,
    plan: { ...plan, items: plan.items.map((i) => (i.id === itemId ? updated : i)) },
    summary: `${itemName(item)} ${parts.join(", ")}`,
  };
}

/** Turns furniture or a column a quarter turn (or by any angle), about its middle. */
export function rotateItem(plan: Plan, target: PlanItem, by = 90): EditResult {
  if (target.kind === "item") {
    const item = plan.items.find((i) => i.id === target.id);
    if (!item) return fail("That is no longer on the plan.");
    return updateItem(plan, item.id, { rotation: item.rotation + by });
  }
  if (target.kind === "column") {
    const column = plan.columns.find((c) => c.id === target.id);
    if (!column) return fail("That column is no longer on the plan.");
    if (Math.abs(by % 180) !== 90 || column.round || column.width === column.depth) return same(plan);
    return {
      ok: true,
      plan: { ...plan, columns: plan.columns.map((c) => (c.id === column.id ? { ...c, width: c.depth, depth: c.width } : c)) },
      summary: "Column turned",
    };
  }
  return fail("Only furniture and columns can be turned.");
}

/** A copy of furniture, a column or a note, set a little to one side. */
export function duplicate(plan: Plan, target: PlanItem, offset: Point = { x: 500, y: -500 }): EditResult {
  const shift = (p: Point) => ({ x: p.x + offset.x, y: p.y + offset.y });
  if (target.kind === "item") {
    const item = plan.items.find((i) => i.id === target.id);
    if (!item) return fail("That is no longer on the plan.");
    const copy = { ...item, id: newId(), at: shift(item.at) };
    return { ok: true, id: copy.id, plan: { ...plan, items: [...plan.items, copy] }, summary: `${itemName(item)} copied` };
  }
  if (target.kind === "column") {
    const column = plan.columns.find((c) => c.id === target.id);
    if (!column) return fail("That column is no longer on the plan.");
    const copy = { ...column, id: newId(), at: shift(column.at) };
    return { ok: true, id: copy.id, plan: { ...plan, columns: [...plan.columns, copy] }, summary: "Column copied" };
  }
  if (target.kind === "note") {
    const note = plan.notes.find((n) => n.id === target.id);
    if (!note) return fail("That note is no longer on the plan.");
    const copy = { ...note, id: newId(), at: shift(note.at) };
    return { ok: true, id: copy.id, plan: { ...plan, notes: [...plan.notes, copy] }, summary: "Note copied" };
  }
  return fail("Only furniture, columns and notes can be copied.");
}

// ---------------------------------------------------------------------------
// Notes and dimension lines
// ---------------------------------------------------------------------------

export function addNote(plan: Plan, at: Point, text: string, levelId: string = plan.levels[0].id): EditResult {
  const words = text.trim().slice(0, 500);
  if (!words) return fail("Type the note first.");
  if (!finite(at.x, at.y)) return fail("That point is off the plan.");
  const id = newId();
  return { ok: true, id, plan: { ...plan, notes: [...plan.notes, { id, levelId, at: { ...at }, text: words }] }, summary: `Note added: "${words.slice(0, 40)}"` };
}

export function updateNote(plan: Plan, noteId: string, text: string): EditResult {
  const note = plan.notes.find((n) => n.id === noteId);
  if (!note) return fail("That note is no longer on the plan.");
  const words = text.trim().slice(0, 500);
  if (!words) return fail("A note needs some words. Remove it instead.");
  if (words === note.text) return same(plan);
  return {
    ok: true,
    plan: { ...plan, notes: plan.notes.map((n) => (n.id === noteId ? { ...n, text: words } : n)) },
    summary: `Note changed to "${words.slice(0, 40)}"`,
  };
}

export function addDimension(plan: Plan, a: Point, b: Point, levelId: string = plan.levels[0].id, offset = 400): EditResult {
  if (!finite(a.x, a.y, b.x, b.y)) return fail("That point is off the plan.");
  const length = distance(a, b);
  if (length < 10) return fail("Pick two different points to measure between.");
  const id = newId();
  return {
    ok: true,
    id,
    plan: { ...plan, dimensions: [...plan.dimensions, { id, levelId, a: { ...a }, b: { ...b }, offset }] },
    summary: `Dimension added, ${mm(length)}`,
  };
}

export function updateDimension(plan: Plan, dimensionId: string, offset: number): EditResult {
  const dim = plan.dimensions.find((d) => d.id === dimensionId);
  if (!dim) return fail("That dimension is no longer on the plan.");
  if (!Number.isFinite(offset) || Math.abs(offset) > 100_000) return fail("Type how far off the line it sits, in millimetres.");
  if (Math.abs(offset - dim.offset) < 0.5) return same(plan);
  return { ok: true, plan: { ...plan, dimensions: plan.dimensions.map((d) => (d.id === dimensionId ? { ...d, offset } : d)) }, summary: "" };
}

// ---------------------------------------------------------------------------
// Walls
// ---------------------------------------------------------------------------

export function updateWall(plan: Plan, wallId: string, patch: { kind?: WallKind; height?: number | null }): EditResult {
  const wall = plan.walls.find((w) => w.id === wallId);
  if (!wall) return fail("That wall is no longer on the plan.");
  const updated: Wall = { ...wall };
  const parts: string[] = [];
  if (patch.kind && patch.kind !== wall.kind) {
    updated.kind = patch.kind;
    parts.push(patch.kind === "partition" ? "Wall made a partition" : "Partition made a wall");
  }
  if (patch.height !== undefined) {
    if (patch.height === null) {
      delete updated.height;
      if (wall.height != null) parts.push("Wall height set back to the floor's height");
    } else {
      if (!Number.isFinite(patch.height) || patch.height < 100 || patch.height > 30_000) {
        return fail(`A wall's height must be between ${mm(100)} and ${mm(30_000)}.`);
      }
      if (patch.height !== wall.height) {
        updated.height = patch.height;
        parts.push(`Wall height set to ${mm(patch.height)}`);
      }
    }
  }
  if (!parts.length) return same(plan);
  return { ok: true, plan: { ...plan, walls: plan.walls.map((w) => (w.id === wallId ? updated : w)) }, summary: parts.join("; ") };
}

/** The height a wall stands to: its own, or its floor's. */
export function wallHeight(plan: Plan, wall: Wall): number {
  return wall.height ?? levelOf(plan, wall.levelId).height;
}

// ---------------------------------------------------------------------------
// Moving things by dragging
// ---------------------------------------------------------------------------

/** Checks a moved plan the same way a typed length is checked. */
function checked(plan: Plan, summary: string): EditResult {
  for (const w of plan.walls) {
    const len = wallLength(w);
    if (len < LIMITS.minWall) return fail(`That would shrink a wall to ${mm(len)}, which is too short.`);
    const problem = openingsFit(plan, w.id, len);
    if (problem) return fail(problem);
  }
  const room = brokenRoom(plan);
  if (room) return fail(`That would fold ${room.name} over itself.`);
  return { ok: true, plan, summary };
}

/**
 * Moves what is selected by `delta`. Furniture, columns, notes and dimension
 * lines move freely. A door or window slides along its wall. A wall moves
 * square to itself, taking the ends of the walls joined to it and the room
 * corners with it, the way dragging a wall works in Revit.
 */
export function moveBy(plan: Plan, target: PlanItem, delta: Point): EditResult {
  if (!finite(delta.x, delta.y)) return fail("That point is off the plan.");
  if (Math.hypot(delta.x, delta.y) < 0.5) return same(plan);
  const shift = (p: Point) => ({ x: p.x + delta.x, y: p.y + delta.y });
  const moved = `moved ${mm(Math.hypot(delta.x, delta.y))}`;
  switch (target.kind) {
    case "item": {
      const item = plan.items.find((i) => i.id === target.id);
      if (!item) return fail("That is no longer on the plan.");
      return { ok: true, plan: { ...plan, items: plan.items.map((i) => (i.id === item.id ? { ...i, at: shift(i.at) } : i)) }, summary: `${itemName(item)} ${moved}` };
    }
    case "column": {
      if (!plan.columns.some((c) => c.id === target.id)) return fail("That column is no longer on the plan.");
      return { ok: true, plan: { ...plan, columns: plan.columns.map((c) => (c.id === target.id ? { ...c, at: shift(c.at) } : c)) }, summary: `Column ${moved}` };
    }
    case "note": {
      if (!plan.notes.some((n) => n.id === target.id)) return fail("That note is no longer on the plan.");
      return { ok: true, plan: { ...plan, notes: plan.notes.map((n) => (n.id === target.id ? { ...n, at: shift(n.at) } : n)) }, summary: `Note ${moved}` };
    }
    case "dimension": {
      if (!plan.dimensions.some((d) => d.id === target.id)) return fail("That dimension is no longer on the plan.");
      return {
        ok: true,
        plan: { ...plan, dimensions: plan.dimensions.map((d) => (d.id === target.id ? { ...d, a: shift(d.a), b: shift(d.b) } : d)) },
        summary: `Dimension ${moved}`,
      };
    }
    case "opening": {
      const opening = plan.openings.find((o) => o.id === target.id);
      const wall = opening && plan.walls.find((w) => w.id === opening.wallId);
      if (!opening || !wall) return fail("That opening is no longer on the plan.");
      const len = wallLength(wall) || 1;
      const along = (delta.x * (wall.b.x - wall.a.x) + delta.y * (wall.b.y - wall.a.y)) / len;
      if (Math.abs(along) < 0.5) return same(plan);
      const at = Math.round(opening.at + along);
      const next = { ...plan, openings: plan.openings.map((o) => (o.id === opening.id ? { ...o, at } : o)) };
      const problem = openingsFit(next, wall.id, len);
      if (problem) return fail(problem);
      return { ok: true, plan: next, summary: `${opening.kind === "door" ? "Door" : "Window"} moved ${mm(Math.abs(along))} along the wall` };
    }
    case "wall": {
      const wall = plan.walls.find((w) => w.id === target.id);
      if (!wall) return fail("That wall is no longer on the plan.");
      const len = wallLength(wall) || 1;
      const n = { x: -(wall.b.y - wall.a.y) / len, y: (wall.b.x - wall.a.x) / len };
      const across = delta.x * n.x + delta.y * n.y;
      if (Math.abs(across) < 0.5) return same(plan);
      const step = { x: n.x * across, y: n.y * across };
      const to = (p: Point) => ({ x: p.x + step.x, y: p.y + step.y });
      // Move the far end first in case the two ends share a point with each other's neighbours.
      let next = movePoint(plan, wall.b, to(wall.b), wall.levelId);
      next = movePoint(next, wall.a, to(wall.a), wall.levelId);
      // Columns, furniture and notes stay where they are; the openings on this wall stay at their distance along it.
      return checked(next, `Wall moved ${mm(Math.abs(across))} sideways`);
    }
    case "room": {
      const room = plan.rooms.find((r) => r.id === target.id);
      if (!room) return fail("That room is no longer on the plan.");
      // A room's outline belongs to its walls; moving it alone would leave it off them.
      return fail("Move a room's walls to change it.");
    }
  }
}

/** Moves one wall end, and every wall end and room corner joined to it, to a new point. */
export function moveCorner(plan: Plan, from: Point, to: Point, levelId: string): EditResult {
  if (!finite(to.x, to.y)) return fail("That point is off the plan.");
  if (samePoint(from, to)) return same(plan);
  return checked(movePoint(plan, from, to, levelId), `Corner moved ${mm(distance(from, to))}`);
}

// ---------------------------------------------------------------------------
// Floors
// ---------------------------------------------------------------------------

export function addLevel(plan: Plan, name?: string): EditResult {
  const top = plan.levels.reduce((t, l) => (l.elevation > t.elevation ? l : t), plan.levels[0]);
  const level: Level = {
    id: newId(),
    name: (name?.trim() || `Floor ${plan.levels.length}`).slice(0, 120),
    elevation: top.elevation + top.height,
    height: top.height,
  };
  return { ok: true, id: level.id, plan: { ...plan, levels: [...plan.levels, level] }, summary: `${level.name} added` };
}

/** A new floor above the top one, with the walls, doors, windows and columns of `fromId` copied onto it. */
export function copyLevel(plan: Plan, fromId: string): EditResult {
  const from = plan.levels.find((l) => l.id === fromId);
  if (!from) return fail("That floor is no longer on the plan.");
  const added = addLevel(plan, `${from.name} (copy)`);
  if (!added.ok) return added;
  const levelId = added.id!;
  const wallIds = new Map<string, string>();
  const walls = plan.walls
    .filter((w) => w.levelId === fromId)
    .map((w) => {
      const id = newId();
      wallIds.set(w.id, id);
      return { ...w, id, levelId };
    });
  const openings = plan.openings.filter((o) => wallIds.has(o.wallId)).map((o) => ({ ...o, id: newId(), wallId: wallIds.get(o.wallId)! }));
  const columns = plan.columns.filter((c) => c.levelId === fromId).map((c) => ({ ...c, id: newId(), levelId }));
  return {
    ok: true,
    id: levelId,
    plan: {
      ...added.plan,
      levels: added.plan.levels.map((l) => (l.id === levelId ? { ...l, height: from.height } : l)),
      walls: [...plan.walls, ...walls],
      openings: [...plan.openings, ...openings],
      columns: [...plan.columns, ...columns],
    },
    summary: `${from.name} copied as a new floor, with ${walls.length} wall${walls.length === 1 ? "" : "s"}`,
  };
}

export function updateLevel(plan: Plan, levelId: string, patch: Partial<Pick<Level, "name" | "elevation" | "height">>): EditResult {
  const level = plan.levels.find((l) => l.id === levelId);
  if (!level) return fail("That floor is no longer on the plan.");
  const name = patch.name != null ? patch.name.trim().slice(0, 120) : level.name;
  if (!name) return fail("Give the floor a name.");
  const elevation = patch.elevation ?? level.elevation;
  const height = patch.height ?? level.height;
  if (!Number.isFinite(elevation) || elevation < -100_000 || elevation > 1_000_000) return fail("Type the floor's level in millimetres.");
  if (!Number.isFinite(height) || height < 1_000 || height > 30_000) return fail(`A floor's height must be between ${mm(1_000)} and ${mm(30_000)}.`);
  const parts: string[] = [];
  if (name !== level.name) parts.push(`${level.name} renamed ${name}`);
  if (elevation !== level.elevation) parts.push(`${name} set at ${mm(elevation)}`);
  if (height !== level.height) parts.push(`${name} ceiling height set to ${mm(height)}`);
  if (!parts.length) return same(plan);
  return { ok: true, plan: { ...plan, levels: plan.levels.map((l) => (l.id === levelId ? { ...l, name, elevation, height } : l)) }, summary: parts.join("; ") };
}

/** Removes a floor and everything drawn on it. The last floor cannot go. */
export function removeLevel(plan: Plan, levelId: string): EditResult {
  const level = plan.levels.find((l) => l.id === levelId);
  if (!level) return fail("That floor is no longer on the plan.");
  if (plan.levels.length === 1) return fail("A plan needs at least one floor.");
  const keep = <T extends { levelId?: string }>(xs: T[]) => xs.filter((x) => x.levelId !== levelId);
  const walls = keep(plan.walls);
  const wallIds = new Set(walls.map((w) => w.id));
  return {
    ok: true,
    plan: {
      ...plan,
      levels: plan.levels.filter((l) => l.id !== levelId),
      walls,
      openings: plan.openings.filter((o) => wallIds.has(o.wallId)),
      columns: keep(plan.columns),
      rooms: keep(plan.rooms),
      items: keep(plan.items),
      notes: keep(plan.notes),
      dimensions: keep(plan.dimensions),
      underlays: keep(plan.underlays),
      reference: plan.reference.filter((l) => (l.levelId ?? plan.levels[0].id) !== levelId),
      layouts: keep(plan.layouts),
    },
    summary: `${level.name} removed`,
  };
}

/** Floors from the lowest up, as they are listed. */
export function sortedLevels(plan: Plan): Level[] {
  return [...plan.levels].sort((p, q) => p.elevation - q.elevation);
}

// ---------------------------------------------------------------------------
// An image to trace over
// ---------------------------------------------------------------------------

/** Puts an image under one floor, `width` mm wide with its bottom-left corner at `at`. Replaces any image already there. */
export function setUnderlay(plan: Plan, underlay: Underlay): EditResult {
  if (!finite(underlay.at.x, underlay.at.y) || !(underlay.width > 0)) return fail("That image cannot be placed there.");
  const replaced = plan.underlays.some((u) => u.levelId === underlay.levelId);
  return {
    ok: true,
    plan: { ...plan, underlays: [...plan.underlays.filter((u) => u.levelId !== underlay.levelId), underlay] },
    summary: `${replaced ? "Tracing image replaced with" : "Tracing image added:"} ${underlay.name}`,
  };
}

export function updateUnderlay(plan: Plan, levelId: string, patch: Partial<Pick<Underlay, "opacity" | "at" | "width">>): EditResult {
  const underlay = plan.underlays.find((u) => u.levelId === levelId);
  if (!underlay) return fail("There is no tracing image on this floor.");
  const updated = { ...underlay, ...patch };
  if (!(updated.width > 0) || !finite(updated.at.x, updated.at.y)) return fail("That would put the image off the plan.");
  updated.opacity = Math.max(0.05, Math.min(1, updated.opacity));
  return { ok: true, plan: { ...plan, underlays: plan.underlays.map((u) => (u.levelId === levelId ? updated : u)) }, summary: "" };
}

/**
 * Scales the image so the distance between two points picked on it is the
 * true distance typed, keeping the first point where it is. This is how a
 * photo or a scan is brought to scale: pick both ends of a wall you know.
 */
export function calibrateUnderlay(plan: Plan, levelId: string, p: Point, q: Point, trueDistance: number): EditResult {
  const underlay = plan.underlays.find((u) => u.levelId === levelId);
  if (!underlay) return fail("There is no tracing image on this floor.");
  const picked = distance(p, q);
  if (picked < 1) return fail("Pick two different points on the image.");
  if (!Number.isFinite(trueDistance) || trueDistance < 10 || trueDistance > LIMITS.maxWall) {
    return fail(`Type the true distance in millimetres, between ${mm(10)} and ${mm(LIMITS.maxWall)}.`);
  }
  const k = trueDistance / picked;
  const at = { x: p.x + (underlay.at.x - p.x) * k, y: p.y + (underlay.at.y - p.y) * k };
  const updated = { ...underlay, at, width: underlay.width * k };
  return {
    ok: true,
    plan: { ...plan, underlays: plan.underlays.map((u) => (u.levelId === levelId ? updated : u)) },
    summary: `Tracing image scaled so the picked line is ${mm(trueDistance)}`,
  };
}

export function removeUnderlay(plan: Plan, levelId: string): EditResult {
  const underlay = plan.underlays.find((u) => u.levelId === levelId);
  if (!underlay) return same(plan);
  return { ok: true, plan: { ...plan, underlays: plan.underlays.filter((u) => u.levelId !== levelId) }, summary: `Tracing image ${underlay.name} removed` };
}

// ---------------------------------------------------------------------------
// Rooms from walls
// ---------------------------------------------------------------------------

const key = (p: Point) => `${Math.round(p.x)},${Math.round(p.y)}`;

/** Where two segments cross, as a fraction along the first, if they do. */
function crossAt(a: Point, b: Point, c: Point, d: Point): number | null {
  const r = { x: b.x - a.x, y: b.y - a.y };
  const s = { x: d.x - c.x, y: d.y - c.y };
  const den = r.x * s.y - r.y * s.x;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((c.x - a.x) * s.y - (c.y - a.y) * s.x) / den;
  const u = ((c.x - a.x) * r.y - (c.y - a.y) * r.x) / den;
  const len = Math.hypot(r.x, r.y) || 1;
  const slen = Math.hypot(s.x, s.y) || 1;
  const tol = 1;
  if (t < -tol / len || t > 1 + tol / len || u < -tol / slen || u > 1 + tol / slen) return null;
  return Math.max(0, Math.min(1, t));
}

/**
 * The outline of the space around `p` enclosed by the walls of one floor,
 * traced along their centre lines; null when the walls do not close around it.
 * This is Revit's room tool: click inside, get the room.
 */
export function enclosureAt(plan: Plan, p: Point, levelId: string): Point[] | null {
  const walls = plan.walls.filter((w) => w.levelId === levelId);
  // Split every wall where another wall meets or crosses it.
  const segments: [Point, Point][] = [];
  for (const w of walls) {
    const cuts = [0, 1];
    for (const o of walls) {
      if (o === w) continue;
      const t = crossAt(w.a, w.b, o.a, o.b);
      if (t != null) cuts.push(t);
    }
    cuts.sort((x, y) => x - y);
    for (let i = 1; i < cuts.length; i++) {
      const a = { x: w.a.x + (w.b.x - w.a.x) * cuts[i - 1], y: w.a.y + (w.b.y - w.a.y) * cuts[i - 1] };
      const b = { x: w.a.x + (w.b.x - w.a.x) * cuts[i], y: w.a.y + (w.b.y - w.a.y) * cuts[i] };
      if (distance(a, b) > 1) segments.push([a, b]);
    }
  }
  // A graph of corners, with ends closer than a millimetre treated as one.
  const points = new Map<string, Point>();
  const edges = new Map<string, Set<string>>();
  const link = (u: string, v: string) => {
    if (u === v) return;
    if (!edges.has(u)) edges.set(u, new Set());
    if (!edges.has(v)) edges.set(v, new Set());
    edges.get(u)!.add(v);
    edges.get(v)!.add(u);
  };
  for (const [a, b] of segments) {
    const ka = key(a);
    const kb = key(b);
    if (!points.has(ka)) points.set(ka, a);
    if (!points.has(kb)) points.set(kb, b);
    link(ka, kb);
  }
  // Walls that lead nowhere cannot bound a room.
  let pruned = true;
  while (pruned) {
    pruned = false;
    for (const [k, next] of edges) {
      if (next.size < 2) {
        for (const n of next) edges.get(n)?.delete(k);
        edges.delete(k);
        pruned = true;
      }
    }
  }
  if (!edges.size) return null;
  const angle = (from: string, to: string) => {
    const a = points.get(from)!;
    const b = points.get(to)!;
    return Math.atan2(b.y - a.y, b.x - a.x);
  };
  // Walk every face, always taking the sharpest left turn, so each walk goes round one space anticlockwise.
  const seen = new Set<string>();
  let best: Point[] | null = null;
  let bestArea = Infinity;
  for (const [u, nexts] of edges) {
    for (const v of nexts) {
      if (seen.has(`${u}>${v}`)) continue;
      const face: string[] = [];
      let from = u;
      let to = v;
      for (let guard = 0; guard < 10_000 && !seen.has(`${from}>${to}`); guard++) {
        seen.add(`${from}>${to}`);
        face.push(from);
        const back = angle(to, from);
        let pick: string | null = null;
        let pickTurn = Infinity;
        for (const n of edges.get(to) ?? []) {
          if (n === from && (edges.get(to)?.size ?? 0) > 1) continue;
          // Turn measured clockwise from the way back; the smallest is the sharpest left.
          let turn = back - angle(to, n);
          while (turn <= 1e-9) turn += 2 * Math.PI;
          if (turn < pickTurn) {
            pickTurn = turn;
            pick = n;
          }
        }
        if (!pick) break;
        from = to;
        to = pick;
      }
      if (face.length < 3) continue;
      const outline = face.map((k) => points.get(k)!);
      // Anticlockwise walks are the spaces; the one clockwise walk is the outside of the building.
      let signed = 0;
      for (let i = 0; i < outline.length; i++) {
        const a = outline[i];
        const b = outline[(i + 1) % outline.length];
        signed += a.x * b.y - b.x * a.y;
      }
      if (signed <= 0) continue;
      const area = polygonArea(outline);
      if (area < bestArea && pointInPolygon(p, outline)) {
        best = outline;
        bestArea = area;
      }
    }
  }
  return best && simplify(best);
}

/** Drops corners that sit on a straight run, so a room has only its real corners. */
function simplify(points: Point[]): Point[] {
  const out = points.filter((b, i) => {
    const a = points[(i - 1 + points.length) % points.length];
    const c = points[(i + 1) % points.length];
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    return Math.abs(cross) / (distance(a, b) * distance(b, c) || 1) > 1e-6;
  });
  return out.length >= 3 ? out : points;
}

/** Makes a room from the walls around a clicked point. */
export function roomAt(plan: Plan, p: Point, levelId: string, name?: string): EditResult {
  const outline = enclosureAt(plan, p, levelId);
  if (!outline) return fail("The walls around that point do not close. Draw the room's corners instead, or close the gap.");
  const existing = plan.rooms.find((r) => r.levelId === levelId && pointInPolygon(p, r.points));
  if (existing && Math.abs(polygonArea(existing.points) - polygonArea(outline)) < 1_000) {
    return fail(`That space is already ${existing.name}.`);
  }
  const result = addRoom(plan, outline, name ?? `Room ${plan.rooms.filter((r) => r.levelId === levelId).length + 1}`, levelId);
  if (!result.ok) return result;
  const room = result.plan.rooms.find((r) => r.id === result.id)!;
  // A room this one was split off from shrinks to the walls that now bound it, so no floor is counted twice.
  const parts: string[] = [];
  const rooms = result.plan.rooms.map((r) => {
    if (r.id === room.id || r.levelId !== levelId || !pointInPolygon(p, r.points)) return r;
    const inside = pointOutside(r.points, outline);
    const traced = inside && enclosureAt(result.plan, inside, levelId);
    if (!traced || polygonArea(traced) >= polygonArea(r.points) - 1) return r;
    parts.push(`${r.name} now ${m2(polygonArea(traced) / 1_000_000)}`);
    return { ...r, points: traced };
  });
  return {
    ...result,
    plan: { ...result.plan, rooms },
    summary: [`${room.name} found from its walls, ${m2(polygonArea(room.points) / 1_000_000)}`, ...parts].join("; "),
  };
}

/** A point inside one outline but not inside another, found on a grid; null when there is none. */
function pointOutside(outer: Point[], hole: Point[]): Point | null {
  const xs = outer.map((q) => q.x);
  const ys = outer.map((q) => q.y);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  for (let i = 1; i < 24; i++) {
    for (let j = 1; j < 24; j++) {
      const q = { x: x0 + ((x1 - x0) * i) / 24, y: y0 + ((y1 - y0) * j) / 24 };
      if (pointInPolygon(q, outer) && !pointInPolygon(q, hole)) return q;
    }
  }
  return null;
}


// ---------------------------------------------------------------------------
// Door leaves, for drawing and export
// ---------------------------------------------------------------------------

export interface DoorLeaf {
  /** Where the leaf hangs. */
  hinge: Point;
  /** The jamb it closes against. */
  jamb: Point;
  /** The leaf's free end when fully open, square to the wall. */
  open: Point;
}

/**
 * How a door is drawn in plan: each leaf as a line from its hinge, open square
 * to the wall, with its swing arc back to the jamb. A sliding door or a plain
 * opening has no leaves to swing.
 */
export function doorLeaves(wall: Wall, opening: Opening): DoorLeaf[] {
  const style = opening.style ?? "single";
  if (opening.kind !== "door" || style === "sliding" || style === "opening") return [];
  const len = wallLength(wall) || 1;
  const u = { x: (wall.b.x - wall.a.x) / len, y: (wall.b.y - wall.a.y) / len };
  const side = opening.side ?? 1;
  const n = { x: -u.y * side, y: u.x * side };
  const start = pointAlong(wall, opening.at - opening.width / 2);
  const end = pointAlong(wall, opening.at + opening.width / 2);
  const leaf = (hinge: Point, jamb: Point, width: number): DoorLeaf => ({ hinge, jamb, open: { x: hinge.x + n.x * width, y: hinge.y + n.y * width } });
  if (style === "double") {
    const mid = pointAlong(wall, opening.at);
    return [leaf(start, mid, opening.width / 2), leaf(end, mid, opening.width / 2)];
  }
  return (opening.hinge ?? "start") === "start" ? [leaf(start, end, opening.width)] : [leaf(end, start, opening.width)];
}
