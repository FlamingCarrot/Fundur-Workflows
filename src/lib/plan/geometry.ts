/**
 * Floor plan geometry (phase 3).
 *
 * A plan is kept as editable geometry, not as a drawing: walls are centre
 * lines with a thickness, doors and windows sit on a wall at a distance along
 * it, rooms are closed outlines with a name. Everything is in millimetres, with
 * y pointing up as it does in CAD.
 *
 * Walls that meet share an end point exactly, and room corners sit on those
 * same points. That is what lets one typed measurement move everything joined
 * to it: changing a wall's length moves its end, the walls that end there, and
 * the corners of the rooms they bound, so the room areas follow.
 *
 * Every edit is a pure function that returns the new plan and a line for the
 * corrections log, or the reason the value is impossible.
 */

export interface Point {
  x: number;
  y: number;
}

export interface Wall {
  id: string;
  a: Point;
  b: Point;
  /** Millimetres. */
  thickness: number;
}

export type OpeningKind = "door" | "window";

export interface Opening {
  id: string;
  wallId: string;
  kind: OpeningKind;
  /** Distance from the wall's start to the middle of the opening, in mm. */
  at: number;
  width: number;
}

export interface Column {
  id: string;
  /** The middle of the column. */
  at: Point;
  width: number;
  depth: number;
}

export interface Room {
  id: string;
  name: string;
  /** Its corners in order, not repeating the first. */
  points: Point[];
  /** Whether it counts towards the usable area (a riser or shaft does not). */
  usable: boolean;
}

/** A line from an imported file the app did not turn into a wall; shown faintly for reference. */
export interface ReferenceLine {
  a: Point;
  b: Point;
  layer: string;
}

export interface PlanSource {
  name: string;
  format: "dxf";
  importedAt: string;
  warnings: string[];
}

export interface Plan {
  version: 1;
  walls: Wall[];
  openings: Opening[];
  columns: Column[];
  rooms: Room[];
  reference: ReferenceLine[];
  source?: PlanSource;
}

export const LIMITS = {
  minWall: 50,
  maxWall: 300_000,
  minThickness: 20,
  maxThickness: 1_500,
  minOpening: 300,
  maxOpening: 6_000,
  minColumn: 50,
  maxColumn: 5_000,
  /** The smallest room worth naming, in mm² (0.25 m²). */
  minRoomArea: 250_000,
  maxCoord: 10_000_000,
} as const;

export const DEFAULTS = {
  wallThickness: 110,
  door: 900,
  window: 1_200,
  column: 400,
} as const;

/** Points closer than this are the same point; CAD files carry rounding noise. */
export const JOIN_MM = 1;

export type EditResult = { ok: true; plan: Plan; summary: string; id?: string } | { ok: false; error: string };

const fail = (error: string): EditResult => ({ ok: false, error });

export function newId(): string {
  return crypto.randomUUID();
}

export function emptyPlan(): Plan {
  return { version: 1, walls: [], openings: [], columns: [], rooms: [], reference: [] };
}

export function isEmptyPlan(plan: Plan): boolean {
  return !plan.walls.length && !plan.rooms.length && !plan.columns.length && !plan.reference.length;
}

// ---------------------------------------------------------------------------
// Measuring
// ---------------------------------------------------------------------------

export function distance(p: Point, q: Point): number {
  return Math.hypot(q.x - p.x, q.y - p.y);
}

export function samePoint(p: Point, q: Point, tolerance = JOIN_MM): boolean {
  return Math.abs(p.x - q.x) <= tolerance && Math.abs(p.y - q.y) <= tolerance;
}

export function wallLength(wall: Wall): number {
  return distance(wall.a, wall.b);
}

/** The point a distance along a wall from its start. */
export function pointAlong(wall: Wall, at: number): Point {
  const len = wallLength(wall) || 1;
  return { x: wall.a.x + ((wall.b.x - wall.a.x) * at) / len, y: wall.a.y + ((wall.b.y - wall.a.y) * at) / len };
}

/** Signed area by the shoelace formula; positive when the corners run anticlockwise. */
function signedArea(points: Point[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const q = points[(i + 1) % points.length];
    sum += p.x * q.y - q.x * p.y;
  }
  return sum / 2;
}

/** A room's floor area in mm². */
export function polygonArea(points: Point[]): number {
  return Math.abs(signedArea(points));
}

export function roomArea(room: Room): number {
  return polygonArea(room.points) / 1_000_000;
}

/** The floor area that counts, in m²: every usable room added up. */
export function usableArea(plan: Plan): number {
  return plan.rooms.filter((r) => r.usable).reduce((sum, r) => sum + roomArea(r), 0);
}

/** Where a room's name sits: the centre of its area, which is inside for most rooms. */
export function centroid(points: Point[]): Point {
  const a = signedArea(points);
  if (Math.abs(a) < 1e-9) {
    const n = points.length || 1;
    return { x: points.reduce((s, p) => s + p.x, 0) / n, y: points.reduce((s, p) => s + p.y, 0) / n };
  }
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const q = points[(i + 1) % points.length];
    const cross = p.x * q.y - q.x * p.y;
    cx += (p.x + q.x) * cross;
    cy += (p.y + q.y) * cross;
  }
  return { x: cx / (6 * a), y: cy / (6 * a) };
}

function segmentsCross(p1: Point, p2: Point, p3: Point, p4: Point): boolean {
  const d = (a: Point, b: Point, c: Point) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const d1 = d(p3, p4, p1);
  const d2 = d(p3, p4, p2);
  const d3 = d(p1, p2, p3);
  const d4 = d(p1, p2, p4);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/** True when no two edges of the outline cross, so it encloses one area. */
export function isSimplePolygon(points: Point[]): boolean {
  const n = points.length;
  if (n < 3) return false;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      // Edges that share a corner always touch there.
      if (j === i + 1 || (i === 0 && j === n - 1)) continue;
      if (segmentsCross(points[i], points[(i + 1) % n], points[j], points[(j + 1) % n])) return false;
    }
  }
  return true;
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function planBounds(plan: Plan): Bounds | null {
  const xs: number[] = [];
  const ys: number[] = [];
  const add = (p: Point) => {
    xs.push(p.x);
    ys.push(p.y);
  };
  for (const w of plan.walls) {
    add(w.a);
    add(w.b);
  }
  for (const r of plan.rooms) r.points.forEach(add);
  for (const c of plan.columns) {
    add({ x: c.at.x - c.width / 2, y: c.at.y - c.depth / 2 });
    add({ x: c.at.x + c.width / 2, y: c.at.y + c.depth / 2 });
  }
  for (const l of plan.reference) {
    add(l.a);
    add(l.b);
  }
  if (!xs.length) return null;
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
}

// ---------------------------------------------------------------------------
// Finding things under the pointer
// ---------------------------------------------------------------------------

/** The nearest wall to a point, how far along it the point falls, and how far off it. */
export function nearestWall(plan: Plan, p: Point, within: number): { wall: Wall; at: number; off: number } | null {
  let best: { wall: Wall; at: number; off: number } | null = null;
  for (const wall of plan.walls) {
    const len = wallLength(wall);
    if (!len) continue;
    const t = ((p.x - wall.a.x) * (wall.b.x - wall.a.x) + (p.y - wall.a.y) * (wall.b.y - wall.a.y)) / (len * len);
    const clamped = Math.max(0, Math.min(1, t));
    const off = distance(p, pointAlong(wall, clamped * len));
    if (off <= within && (!best || off < best.off)) best = { wall, at: clamped * len, off };
  }
  return best;
}

/** The nearest wall end or room corner, so new lines join existing ones exactly. */
export function snapToCorner(plan: Plan, p: Point, within: number): Point | null {
  let best: Point | null = null;
  let bestD = within;
  const consider = (q: Point) => {
    const d = distance(p, q);
    if (d <= bestD) {
      best = q;
      bestD = d;
    }
  };
  for (const w of plan.walls) {
    consider(w.a);
    consider(w.b);
  }
  for (const r of plan.rooms) r.points.forEach(consider);
  return best;
}

export function pointInPolygon(p: Point, points: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i];
    const b = points[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

// ---------------------------------------------------------------------------
// Words for the corrections log
// ---------------------------------------------------------------------------

export function mm(value: number): string {
  return `${Math.round(value).toLocaleString("en-ZA")} mm`;
}

export function m2(value: number): string {
  return `${value.toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} m²`;
}

const KIND_NAME: Record<OpeningKind, string> = { door: "door", window: "window" };

function finite(...values: number[]): boolean {
  return values.every((v) => Number.isFinite(v) && Math.abs(v) <= LIMITS.maxCoord);
}

// ---------------------------------------------------------------------------
// Edits
// ---------------------------------------------------------------------------

/** Moves every wall end and room corner at one point to another, which is what keeps joined geometry joined. */
export function movePoint(plan: Plan, from: Point, to: Point): Plan {
  const move = (p: Point) => (samePoint(p, from) ? { ...to } : p);
  return {
    ...plan,
    walls: plan.walls.map((w) => ({ ...w, a: move(w.a), b: move(w.b) })),
    rooms: plan.rooms.map((r) => ({ ...r, points: r.points.map(move) })),
  };
}

/** Rooms that a change bent out of shape, so it can be refused rather than saved. */
function brokenRoom(plan: Plan): Room | undefined {
  return plan.rooms.find((r) => !isSimplePolygon(r.points) || polygonArea(r.points) < 1);
}

/** Every opening on a wall stays inside it and clear of the others. */
function openingsFit(plan: Plan, wallId: string, length: number): string | null {
  const on = plan.openings.filter((o) => o.wallId === wallId).sort((p, q) => p.at - q.at);
  for (const o of on) {
    if (o.at - o.width / 2 < -0.5 || o.at + o.width / 2 > length + 0.5) {
      return `The ${KIND_NAME[o.kind]} on this wall (${mm(o.width)}) would no longer fit. Move or narrow it first.`;
    }
  }
  for (let i = 1; i < on.length; i++) {
    if (on[i].at - on[i].width / 2 < on[i - 1].at + on[i - 1].width / 2 - 0.5) {
      return `That would overlap the ${KIND_NAME[on[i - 1].kind]} and the ${KIND_NAME[on[i].kind]} on this wall.`;
    }
  }
  return null;
}

/**
 * Stretches the plan along a direction: everything at or beyond `cut` along
 * `u` from `origin` moves by `delta`, the rest stays. This is CAD's stretch,
 * and it keeps square walls square: lengthening one wall moves the walls on
 * its far side bodily, rather than leaning them over.
 */
export function stretch(plan: Plan, origin: Point, u: Point, cut: number, delta: number): Plan | null {
  const beyond = (p: Point) => (p.x - origin.x) * u.x + (p.y - origin.y) * u.y >= cut - JOIN_MM;
  const move = (p: Point) => (beyond(p) ? { x: p.x + u.x * delta, y: p.y + u.y * delta } : p);
  const walls = plan.walls.map((w) => ({ ...w, a: move(w.a), b: move(w.b) }));
  if (!walls.every((w) => finite(w.a.x, w.a.y, w.b.x, w.b.y))) return null;
  // Doors and windows stay where they are on the floor unless they are on the far side too.
  const openings = plan.openings.map((o) => {
    const before = plan.walls.find((w) => w.id === o.wallId);
    const after = walls.find((w) => w.id === o.wallId);
    if (!before || !after) return o;
    const centre = move(pointAlong(before, o.at));
    const len = wallLength(after) || 1;
    return { ...o, at: ((centre.x - after.a.x) * (after.b.x - after.a.x) + (centre.y - after.a.y) * (after.b.y - after.a.y)) / len };
  });
  return {
    ...plan,
    walls,
    openings,
    columns: plan.columns.map((c) => ({ ...c, at: move(c.at) })),
    rooms: plan.rooms.map((r) => ({ ...r, points: r.points.map(move) })),
    reference: plan.reference.map((l) => ({ ...l, a: move(l.a), b: move(l.b) })),
  };
}

/**
 * Sets a wall to its true length. The end that is kept stays put; the other end
 * moves along the wall's line, and everything beyond it moves the same way, so
 * the walls joined there come along square, the walls across stretch, and the
 * room areas update.
 */
export function setWallLength(plan: Plan, wallId: string, length: number, keep: "a" | "b" = "a"): EditResult {
  const wall = plan.walls.find((w) => w.id === wallId);
  if (!wall) return fail("That wall is no longer on the plan.");
  if (!Number.isFinite(length)) return fail("Type the length in millimetres.");
  if (length < LIMITS.minWall) return fail(`A wall must be at least ${mm(LIMITS.minWall)} long.`);
  if (length > LIMITS.maxWall) return fail(`A wall cannot be longer than ${mm(LIMITS.maxWall)}.`);
  const before = wallLength(wall);
  if (!before) return fail("This wall has no length to scale; draw it again.");
  if (Math.abs(before - length) < 0.5) return { ok: true, plan, summary: "" };

  const fixed = keep === "a" ? wall.a : wall.b;
  const moving = keep === "a" ? wall.b : wall.a;
  const u = { x: (moving.x - fixed.x) / before, y: (moving.y - fixed.y) / before };
  const next = stretch(plan, fixed, u, before, length - before);
  if (!next) return fail("That would put the wall off the plan.");

  for (const w of next.walls) {
    const len = wallLength(w);
    if (w.id !== wallId && len > 0 && len < LIMITS.minWall) {
      return fail(`That would shrink another wall to ${mm(len)}, which is too short.`);
    }
    if (w.id !== wallId && len === 0) return fail("That would collapse another wall to nothing.");
    const problem = openingsFit(next, w.id, len);
    if (problem) return fail(w.id === wallId ? problem : `Another wall would change and ${problem.charAt(0).toLowerCase()}${problem.slice(1)}`);
  }
  const room = brokenRoom(next);
  if (room) return fail(`That would fold ${room.name} over itself. Check the other walls of the room first.`);

  return { ok: true, plan: next, summary: `Wall changed from ${mm(before)} to ${mm(length)}` };
}

export function setWallThickness(plan: Plan, wallId: string, thickness: number): EditResult {
  const wall = plan.walls.find((w) => w.id === wallId);
  if (!wall) return fail("That wall is no longer on the plan.");
  if (!Number.isFinite(thickness) || thickness < LIMITS.minThickness || thickness > LIMITS.maxThickness) {
    return fail(`A wall's thickness must be between ${mm(LIMITS.minThickness)} and ${mm(LIMITS.maxThickness)}.`);
  }
  if (Math.abs(wall.thickness - thickness) < 0.5) return { ok: true, plan, summary: "" };
  return {
    ok: true,
    plan: { ...plan, walls: plan.walls.map((w) => (w.id === wallId ? { ...w, thickness } : w)) },
    summary: `Wall thickness changed from ${mm(wall.thickness)} to ${mm(thickness)}`,
  };
}

export function addWall(plan: Plan, a: Point, b: Point, thickness: number = DEFAULTS.wallThickness): EditResult {
  if (!finite(a.x, a.y, b.x, b.y)) return fail("That point is off the plan.");
  const length = distance(a, b);
  if (length < LIMITS.minWall) return fail(`A wall must be at least ${mm(LIMITS.minWall)} long.`);
  if (length > LIMITS.maxWall) return fail(`A wall cannot be longer than ${mm(LIMITS.maxWall)}.`);
  const id = newId();
  return {
    ok: true,
    id,
    plan: { ...plan, walls: [...plan.walls, { id, a: { ...a }, b: { ...b }, thickness }] },
    summary: `Wall drawn, ${mm(length)}`,
  };
}

export function addOpening(plan: Plan, wallId: string, kind: OpeningKind, at: number, width: number = DEFAULTS[kind]): EditResult {
  const wall = plan.walls.find((w) => w.id === wallId);
  if (!wall) return fail("Put the opening on a wall.");
  const length = wallLength(wall);
  if (width < LIMITS.minOpening || width > LIMITS.maxOpening) {
    return fail(`A ${KIND_NAME[kind]} must be between ${mm(LIMITS.minOpening)} and ${mm(LIMITS.maxOpening)} wide.`);
  }
  if (width > length) return fail(`This wall is ${mm(length)} long, too short for a ${mm(width)} ${KIND_NAME[kind]}.`);
  // Pulled back inside the wall when the click was near an end.
  const centre = Math.max(width / 2, Math.min(length - width / 2, at));
  const opening: Opening = { id: newId(), wallId, kind, at: centre, width };
  const next = { ...plan, openings: [...plan.openings, opening] };
  const problem = openingsFit(next, wallId, length);
  if (problem) return fail(problem);
  return { ok: true, id: opening.id, plan: next, summary: `${kind === "door" ? "Door" : "Window"} added, ${mm(width)}` };
}

export function updateOpening(
  plan: Plan,
  openingId: string,
  patch: Partial<Pick<Opening, "at" | "width" | "kind">>
): EditResult {
  const opening = plan.openings.find((o) => o.id === openingId);
  if (!opening) return fail("That opening is no longer on the plan.");
  const wall = plan.walls.find((w) => w.id === opening.wallId);
  if (!wall) return fail("That opening's wall is no longer on the plan.");
  const updated = { ...opening, ...patch };
  if (!Number.isFinite(updated.width) || updated.width < LIMITS.minOpening || updated.width > LIMITS.maxOpening) {
    return fail(`A ${KIND_NAME[updated.kind]} must be between ${mm(LIMITS.minOpening)} and ${mm(LIMITS.maxOpening)} wide.`);
  }
  if (!Number.isFinite(updated.at)) return fail("Type the distance in millimetres.");
  const next = { ...plan, openings: plan.openings.map((o) => (o.id === openingId ? updated : o)) };
  const problem = openingsFit(next, wall.id, wallLength(wall));
  if (problem) return fail(problem);
  const parts: string[] = [];
  if (patch.kind && patch.kind !== opening.kind) parts.push(`now a ${KIND_NAME[patch.kind]}`);
  if (patch.width != null && Math.abs(patch.width - opening.width) >= 0.5) parts.push(`${mm(opening.width)} to ${mm(updated.width)} wide`);
  if (patch.at != null && Math.abs(patch.at - opening.at) >= 0.5) parts.push(`moved ${mm(Math.abs(updated.at - opening.at))}`);
  if (!parts.length) return { ok: true, plan, summary: "" };
  return { ok: true, plan: next, summary: `${opening.kind === "door" ? "Door" : "Window"} ${parts.join(", ")}` };
}

export function addColumn(plan: Plan, at: Point, width: number = DEFAULTS.column, depth: number = DEFAULTS.column): EditResult {
  if (!finite(at.x, at.y)) return fail("That point is off the plan.");
  const problem = columnSizeProblem(width, depth);
  if (problem) return fail(problem);
  const id = newId();
  return {
    ok: true,
    id,
    plan: { ...plan, columns: [...plan.columns, { id, at: { ...at }, width, depth }] },
    summary: `Column added, ${mm(width)} by ${mm(depth)}`,
  };
}

function columnSizeProblem(width: number, depth: number): string | null {
  if (![width, depth].every((v) => Number.isFinite(v) && v >= LIMITS.minColumn && v <= LIMITS.maxColumn)) {
    return `A column's sides must be between ${mm(LIMITS.minColumn)} and ${mm(LIMITS.maxColumn)}.`;
  }
  return null;
}

export function updateColumn(plan: Plan, columnId: string, patch: Partial<Pick<Column, "width" | "depth">>): EditResult {
  const column = plan.columns.find((c) => c.id === columnId);
  if (!column) return fail("That column is no longer on the plan.");
  const updated = { ...column, ...patch };
  const problem = columnSizeProblem(updated.width, updated.depth);
  if (problem) return fail(problem);
  if (updated.width === column.width && updated.depth === column.depth) return { ok: true, plan, summary: "" };
  return {
    ok: true,
    plan: { ...plan, columns: plan.columns.map((c) => (c.id === columnId ? updated : c)) },
    summary: `Column changed from ${mm(column.width)} by ${mm(column.depth)} to ${mm(updated.width)} by ${mm(updated.depth)}`,
  };
}

export function addRoom(plan: Plan, points: Point[], name?: string): EditResult {
  const corners = points.filter((p, i) => i === 0 || !samePoint(p, points[i - 1]));
  if (corners.length > 2 && samePoint(corners[0], corners[corners.length - 1])) corners.pop();
  if (corners.length < 3) return fail("A room needs at least three corners.");
  if (!corners.every((p) => finite(p.x, p.y))) return fail("That point is off the plan.");
  if (!isSimplePolygon(corners)) return fail("The room's outline crosses itself. Click its corners in order around the room.");
  if (polygonArea(corners) < LIMITS.minRoomArea) return fail("That room is smaller than 0.25 m².");
  const roomName = name?.trim() || `Room ${plan.rooms.length + 1}`;
  const room: Room = { id: newId(), name: roomName.slice(0, 120), points: corners.map((p) => ({ ...p })), usable: true };
  return { ok: true, id: room.id, plan: { ...plan, rooms: [...plan.rooms, room] }, summary: `${room.name} drawn, ${m2(roomArea(room))}` };
}

export function updateRoom(plan: Plan, roomId: string, patch: Partial<Pick<Room, "name" | "usable">>): EditResult {
  const room = plan.rooms.find((r) => r.id === roomId);
  if (!room) return fail("That room is no longer on the plan.");
  const name = patch.name != null ? patch.name.trim().slice(0, 120) : room.name;
  if (!name) return fail("Give the room a name.");
  const usable = patch.usable ?? room.usable;
  if (name === room.name && usable === room.usable) return { ok: true, plan, summary: "" };
  const parts: string[] = [];
  if (name !== room.name) parts.push(`${room.name} renamed ${name}`);
  if (usable !== room.usable) parts.push(`${name} ${usable ? "now counts" : "no longer counts"} towards the usable area`);
  return { ok: true, plan: { ...plan, rooms: plan.rooms.map((r) => (r.id === roomId ? { ...r, name, usable } : r)) }, summary: parts.join("; ") };
}

export type PlanItem = { kind: "wall" | "opening" | "column" | "room"; id: string };

export function removeItem(plan: Plan, item: PlanItem): EditResult {
  switch (item.kind) {
    case "wall": {
      const wall = plan.walls.find((w) => w.id === item.id);
      if (!wall) return fail("That wall is no longer on the plan.");
      const openings = plan.openings.filter((o) => o.wallId === item.id).length;
      return {
        ok: true,
        plan: {
          ...plan,
          walls: plan.walls.filter((w) => w.id !== item.id),
          openings: plan.openings.filter((o) => o.wallId !== item.id),
        },
        summary: `Wall removed, ${mm(wallLength(wall))}${openings ? ` with ${openings} opening${openings === 1 ? "" : "s"}` : ""}`,
      };
    }
    case "opening": {
      const opening = plan.openings.find((o) => o.id === item.id);
      if (!opening) return fail("That opening is no longer on the plan.");
      return {
        ok: true,
        plan: { ...plan, openings: plan.openings.filter((o) => o.id !== item.id) },
        summary: `${opening.kind === "door" ? "Door" : "Window"} removed`,
      };
    }
    case "column": {
      if (!plan.columns.some((c) => c.id === item.id)) return fail("That column is no longer on the plan.");
      return { ok: true, plan: { ...plan, columns: plan.columns.filter((c) => c.id !== item.id) }, summary: "Column removed" };
    }
    case "room": {
      const room = plan.rooms.find((r) => r.id === item.id);
      if (!room) return fail("That room is no longer on the plan.");
      return { ok: true, plan: { ...plan, rooms: plan.rooms.filter((r) => r.id !== item.id) }, summary: `${room.name} removed` };
    }
  }
}

// ---------------------------------------------------------------------------
// Comparing two versions
// ---------------------------------------------------------------------------

export interface PlanDiff {
  walls: { added: number; removed: number; changed: number };
  openings: { added: number; removed: number; changed: number };
  columns: { added: number; removed: number; changed: number };
  rooms: { name: string; before: number | null; after: number | null }[];
  usableBefore: number;
  usableAfter: number;
}

function countChanges<T extends { id: string }>(before: T[], after: T[]): { added: number; removed: number; changed: number } {
  const old = new Map(before.map((x) => [x.id, JSON.stringify(x)]));
  const now = new Map(after.map((x) => [x.id, JSON.stringify(x)]));
  let added = 0;
  let changed = 0;
  for (const [id, value] of now) {
    if (!old.has(id)) added++;
    else if (old.get(id) !== value) changed++;
  }
  const removed = [...old.keys()].filter((id) => !now.has(id)).length;
  return { added, removed, changed };
}

/** What changed between two versions of a plan, room by room. */
export function diffPlans(before: Plan, after: Plan): PlanDiff {
  const rooms = new Map<string, { name: string; before: number | null; after: number | null }>();
  for (const r of before.rooms) rooms.set(r.id, { name: r.name, before: roomArea(r), after: null });
  for (const r of after.rooms) {
    const entry = rooms.get(r.id);
    rooms.set(r.id, { name: r.name, before: entry?.before ?? null, after: roomArea(r) });
  }
  return {
    walls: countChanges(before.walls, after.walls),
    openings: countChanges(before.openings, after.openings),
    columns: countChanges(before.columns, after.columns),
    rooms: [...rooms.values()].sort((p, q) => p.name.localeCompare(q.name)),
    usableBefore: usableArea(before),
    usableAfter: usableArea(after),
  };
}

// ---------------------------------------------------------------------------
// A floor plate to start from
// ---------------------------------------------------------------------------

/**
 * A small office floor plate to try the editor on before a real plan is
 * loaded: an 18 m by 12 m shell with a meeting room, a kitchen, a core and
 * open-plan work space.
 */
export function samplePlan(): Plan {
  let plan = emptyPlan();
  const wall = (a: Point, b: Point, thickness: number = DEFAULTS.wallThickness) => {
    const r = addWall(plan, a, b, thickness);
    if (!r.ok) throw new Error(r.error);
    plan = r.plan;
    return r.id!;
  };
  const p = (x: number, y: number) => ({ x, y });
  // The shell.
  const south = wall(p(0, 0), p(18_000, 0), 230);
  wall(p(18_000, 0), p(18_000, 12_000), 230);
  const north = wall(p(18_000, 12_000), p(0, 12_000), 230);
  wall(p(0, 12_000), p(0, 0), 230);
  // Meeting room in the north-west corner and a kitchen beside it.
  wall(p(0, 7_500), p(5_000, 7_500));
  const meetingEast = wall(p(5_000, 7_500), p(5_000, 12_000));
  wall(p(5_000, 7_500), p(8_500, 7_500));
  wall(p(8_500, 7_500), p(8_500, 12_000));
  // The core: lifts and stairs, not usable floor.
  wall(p(14_000, 7_000), p(18_000, 7_000));
  const coreWest = wall(p(14_000, 7_000), p(14_000, 12_000));

  const add = (r: EditResult) => {
    if (!r.ok) throw new Error(r.error);
    plan = r.plan;
    return r.id!;
  };
  add(addOpening(plan, south, "door", 9_000, 1_800));
  add(addOpening(plan, north, "window", 13_000, 2_400));
  add(addOpening(plan, north, "window", 4_000, 2_400));
  add(addOpening(plan, meetingEast, "door", 1_200));
  add(addOpening(plan, coreWest, "door", 2_500, 1_000));
  add(addColumn(plan, p(6_000, 4_000)));
  add(addColumn(plan, p(12_000, 4_000)));

  add(addRoom(plan, [p(0, 7_500), p(5_000, 7_500), p(5_000, 12_000), p(0, 12_000)], "Meeting room"));
  add(addRoom(plan, [p(5_000, 7_500), p(8_500, 7_500), p(8_500, 12_000), p(5_000, 12_000)], "Kitchen"));
  const core = add(addRoom(plan, [p(14_000, 7_000), p(18_000, 7_000), p(18_000, 12_000), p(14_000, 12_000)], "Core"));
  plan = { ...plan, rooms: plan.rooms.map((r) => (r.id === core ? { ...r, usable: false } : r)) };
  add(
    addRoom(
      plan,
      [p(0, 0), p(18_000, 0), p(18_000, 7_000), p(14_000, 7_000), p(14_000, 12_000), p(8_500, 12_000), p(8_500, 7_500), p(0, 7_500)],
      "Open plan"
    )
  );
  return plan;
}
