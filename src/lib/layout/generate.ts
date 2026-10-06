import {
  newId,
  onLevel,
  pointInPolygon,
  polygonArea,
  type Item,
  type LayoutOption,
  type Plan,
  type Point,
  type Room,
} from "@/lib/plan/geometry";
import { CHAIR_TYPES, DESK_TYPES, checkLayout, teamsAndPairs, type LayoutReport } from "./check";
import type { Adjacency, Department, LayoutRules } from "./rules";
import {
  DOOR,
  Grid,
  INSIDE,
  ROUTE,
  SOLID,
  boxesOverlap,
  columnBox,
  corners,
  doorPoint,
  doorZone,
  itemBox,
  toLocal,
  toWorld,
  wallBoxes,
  type Box,
  type Frame,
} from "./space";

/**
 * The layout generator (P4-02): lays out desks for the brief's teams on one
 * floor, following the designer's rules, in several ways, and keeps the
 * three to five that score best.
 *
 * Each way is a choice of direction (desk rows along the work room's long
 * side or across it), where the main route runs (down the middle, or along
 * the side with the main door), and how many desks make a group. Desks go in
 * groups of two facing rows with their chair space either side, rows apart by
 * the aisle, and single rows against a wall where a double will not fit. The
 * main route is kept clear from every door to the middle of the floor.
 *
 * Every candidate is then checked with the same checker the editor uses
 * (check.ts), and any desk it flags is taken out and the rest checked again,
 * so an option never carries an overlap or a missed clearance.
 *
 * Meeting and board rooms get a table sized to the room. Furniture already on
 * the floor stays where it is, apart from desks and desk chairs in the work
 * rooms, which the generator lays out afresh.
 */

export interface GenerateInput {
  rules: LayoutRules;
  ruleSetName: string;
  headcount: number | null;
  departments: Department[];
  adjacencies: Adjacency[];
}

export interface GeneratedOption {
  option: LayoutOption;
  report: LayoutReport;
  /** Desks that would fit if the headcount allowed. */
  capacity: number;
}

export type GenerateResult = { ok: true; options: GeneratedOption[]; notes: string[] } | { ok: false; error: string };

/** Rooms that are not for desks: their name says what they are for. */
const SUPPORT =
  /meet|board|confer|kitchen|pantry|break|canteen|cafe|toilet|\bwc\b|bath|ablution|shower|store|storage|server|comms|print|copy|recep|lobby|foyer|phone|focus|quiet|wellness|mother|first aid|plant|riser|shaft|stair|lift|core|corridor|passage|archive|filing|locker|parking|balcony|terrace/i;
const MEETING = /meet|board|confer|huddle|training/i;

export function isWorkRoom(room: Room): boolean {
  return room.usable && !SUPPORT.test(room.name);
}

type AngleMode = "long" | "cross";
type SpineMode = "middle" | "door";

interface Strategy {
  angle: AngleMode;
  spine: SpineMode;
  group: number;
}

const STRATEGY_WORDS = {
  long: "rows along the long side",
  cross: "rows across the floor",
  middle: "main route down the middle",
  door: "main route along the entrance side",
};

/** The direction of a room's longest edge, in degrees. */
function longAxis(points: Point[]): number {
  let best = 0;
  let angle = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len > best) {
      best = len;
      angle = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
    }
  }
  // Keep it between -90 and 90 so "along" reads the same whichever way the edge was drawn.
  if (angle > 90) angle -= 180;
  if (angle <= -90) angle += 180;
  return angle;
}

const normal = (degrees: number) => Math.round(((((degrees % 360) + 360) % 360) * 10)) / 10 % 360;

/** Sums over the grid, so a rectangle of cells can be tested for anything in the way at once. */
class Table {
  private readonly sum: Int32Array;
  constructor(private readonly grid: Grid, bad: (flags: number) => boolean) {
    const { cols, rows, cells } = grid;
    this.sum = new Int32Array((cols + 1) * (rows + 1));
    for (let j = 0; j < rows; j++) {
      let run = 0;
      for (let i = 0; i < cols; i++) {
        run += bad(cells[j * cols + i]) ? 1 : 0;
        this.sum[(j + 1) * (cols + 1) + i + 1] = this.sum[j * (cols + 1) + i + 1] + run;
      }
    }
  }

  /** True when nothing bad lies in the local rectangle (in mm). Off the grid counts as bad. */
  clear(x0: number, y0: number, x1: number, y1: number): boolean {
    const g = this.grid;
    // Cells whose middles fall inside the rectangle.
    const i0 = Math.ceil((x0 - g.x0) / g.cell - 0.5);
    const i1 = Math.floor((x1 - g.x0) / g.cell - 0.5);
    const j0 = Math.ceil((y0 - g.y0) / g.cell - 0.5);
    const j1 = Math.floor((y1 - g.y0) / g.cell - 0.5);
    if (i1 < i0 || j1 < j0) return true;
    if (i0 < 0 || j0 < 0 || i1 >= g.cols || j1 >= g.rows) return false;
    const w = g.cols + 1;
    const s = this.sum;
    return s[(j1 + 1) * w + i1 + 1] - s[j0 * w + i1 + 1] - s[(j1 + 1) * w + i0] + s[j0 * w + i0] === 0;
  }
}

/** A run of desks in one room: one or two facing rows, with their chairs. */
interface Group {
  /** Where it sorts: along the room, then across it. */
  order: [number, number];
  /** Desk and chair pairs, in the order they are handed to teams. */
  seats: { desk: Item; chair: Item }[];
}

function seat(frame: Frame, levelId: string, rules: LayoutRules, x: number, deskY: number, facing: 1 | -1): { desk: Item; chair: Item } {
  // facing 1: the chair is on the room's -y side of the desk; -1: on its +y side.
  const chairY = deskY - facing * (rules.deskDepth / 2 + 350);
  return {
    desk: {
      id: newId(),
      levelId,
      type: "desk",
      at: toWorld(frame, { x, y: deskY }),
      width: rules.deskWidth,
      depth: rules.deskDepth,
      rotation: normal(frame.angle + (facing === 1 ? 0 : 180)),
    },
    chair: {
      id: newId(),
      levelId,
      type: "office-chair",
      at: toWorld(frame, { x, y: chairY }),
      width: 600,
      depth: 600,
      // The library draws a chair's back on its +y side, away from the desk.
      rotation: normal(frame.angle + (facing === 1 ? 180 : 0)),
    },
  };
}

interface RoomPlan {
  groups: Group[];
}

/** Lays desks out in one work room for one strategy. */
function layOutRoom(level: Plan, room: Room, kept: Item[], rules: LayoutRules, strategy: Strategy): RoomPlan {
  const base = longAxis(room.points);
  const frame: Frame = { origin: room.points[0], angle: strategy.angle === "long" ? base : base + 90 };
  const grid = Grid.around(frame, room.points, 400);
  grid.markPolygon(room.points, INSIDE);
  for (const w of level.walls) for (const b of wallBoxes(w, level.openings)) grid.markBox(b, SOLID);
  for (const c of level.columns) grid.markBox(columnBox(c, rules.columnClearance), SOLID);
  for (const i of kept) grid.markBox({ ...itemBox(i), w: i.width + rules.aisle, d: i.depth + rules.aisle }, SOLID);

  const wallById = new Map(level.walls.map((w) => [w.id, w]));
  const loc = room.points.map((p) => toLocal(frame, p));
  const minX = Math.min(...loc.map((p) => p.x));
  const maxX = Math.max(...loc.map((p) => p.x));
  const minY = Math.min(...loc.map((p) => p.y));
  const maxY = Math.max(...loc.map((p) => p.y));

  // Doors into this room, and which way is in.
  const doors = level.openings
    .filter((o) => o.kind === "door" && wallById.has(o.wallId))
    .map((o) => {
      const wall = wallById.get(o.wallId)!;
      const { at, normal: n } = doorPoint(wall, o);
      const off = wall.thickness / 2 + 150;
      const inward = pointInPolygon({ x: at.x + n.x * off, y: at.y + n.y * off }, room.points)
        ? n
        : pointInPolygon({ x: at.x - n.x * off, y: at.y - n.y * off }, room.points)
          ? { x: -n.x, y: -n.y }
          : null;
      return inward ? { o, wall, at, inward } : null;
    })
    .filter((d): d is NonNullable<typeof d> => d !== null);
  for (const d of doors) grid.markBox(doorZone(d.wall, d.o, rules.doorClearance), DOOR);

  // Where the main route runs across the room.
  let spineY = (minY + maxY) / 2;
  const main = [...doors].sort((a, b) => b.o.width - a.o.width)[0];
  if (strategy.spine === "door" && main) {
    const inLocal = toLocal({ origin: { x: 0, y: 0 }, angle: frame.angle }, main.inward);
    const atLocal = toLocal(frame, main.at);
    // A door in a side wall: the route runs along that wall. In an end wall: straight in from the door.
    spineY = Math.abs(inLocal.y) > 0.7 ? atLocal.y + Math.sign(inLocal.y) * (main.wall.thickness / 2 + rules.doorClearance / 2 + rules.mainRoute / 2) : atLocal.y;
  }
  const half = rules.mainRoute / 2;
  const routeBox = (a: Point, b: Point): Box => {
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    return {
      c: toWorld(frame, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }),
      w: len + rules.mainRoute,
      d: rules.mainRoute,
      angle: frame.angle + (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI,
    };
  };
  grid.markBox(routeBox({ x: minX - half, y: spineY }, { x: maxX + half, y: spineY }), ROUTE);
  // From each door straight in, then square across to the main route.
  for (const d of doors) {
    const p0 = toLocal(frame, d.at);
    const n = toLocal({ origin: { x: 0, y: 0 }, angle: frame.angle }, d.inward);
    const reach = d.wall.thickness / 2 + rules.doorClearance;
    const p1 = { x: p0.x + n.x * reach, y: p0.y + n.y * reach };
    grid.markBox(routeBox(p0, p1), ROUTE);
    grid.markBox(routeBox(p1, { x: p1.x, y: spineY }), ROUTE);
  }

  const footprint = new Table(grid, (f) => !(f & INSIDE) || (f & (SOLID | ROUTE | DOOR)) !== 0);
  const walkway = new Table(grid, (f) => !(f & (INSIDE | DOOR)) || (f & SOLID) !== 0);

  const { deskWidth: dw, deskDepth: dd, chairSpace: cs, aisle } = rules;
  const doubleDepth = 2 * dd + 2 * cs;
  const singleDepth = dd + cs;
  const sizes = [...rules.groupSizes].sort((a, b) => b - a).filter((g) => g <= strategy.group);
  if (!sizes.length) sizes.push(Math.min(...rules.groupSizes));
  const step = grid.cell;
  const groups: Group[] = [];

  /**
   * One row band: groups along it from one end, each as long as fits.
   * kind "double" has chairs both sides; "single" has its chairs towards
   * `towards` (the route side) and its desks' backs to the wall.
   */
  const placeRow = (y0: number, y1: number, kind: "double" | "single", towards: 1 | -1, rowIndex: number): number => {
    let placed = 0;
    let x = minX;
    while (x + dw <= maxX) {
      let fitted = 0;
      for (const g of kind === "double" ? sizes : sizes.map((s) => s / 2)) {
        const len = (kind === "double" ? g / 2 : g) * dw;
        if (x + len > maxX + 1) continue;
        if (!footprint.clear(x, y0, x + len, y1)) continue;
        // An aisle behind every chair side.
        const behindLow = kind === "double" || towards === -1;
        const behindHigh = kind === "double" || towards === 1;
        if (behindLow && !walkway.clear(x, y0 - aisle, x + len, y0)) continue;
        if (behindHigh && !walkway.clear(x, y1, x + len, y1 + aisle)) continue;
        fitted = len;
        const n = len / dw;
        const seats: Group["seats"] = [];
        for (let k = 0; k < n; k++) {
          const cx = x + dw * (k + 0.5);
          if (kind === "double") {
            seats.push(seat(frame, room.levelId, rules, cx, y0 + cs + dd / 2, 1));
            seats.push(seat(frame, room.levelId, rules, cx, y1 - cs - dd / 2, -1));
          } else if (towards === -1) {
            seats.push(seat(frame, room.levelId, rules, cx, y0 + cs + dd / 2, 1));
          } else {
            seats.push(seat(frame, room.levelId, rules, cx, y1 - cs - dd / 2, -1));
          }
        }
        groups.push({ order: [x, rowIndex], seats });
        placed += seats.length;
        break;
      }
      x += fitted ? fitted + aisle : step;
    }
    return placed;
  };

  /** Rows outward from the main route to one side, finishing with a single row where a double no longer fits. */
  const side = (dir: 1 | -1) => {
    let edge = spineY + dir * half;
    let row = 0;
    for (;;) {
      const far = edge + dir * doubleDepth;
      if (dir === 1 ? far > maxY : far < minY) break;
      const [y0, y1] = dir === 1 ? [edge, far] : [far, edge];
      const placed = placeRow(y0, y1, "double", dir === 1 ? -1 : 1, dir * (row + 1));
      // A band with nothing placed is tried again as a single row before moving on.
      if (!placed) {
        const sFar = edge + dir * singleDepth;
        const [s0, s1] = dir === 1 ? [edge, sFar] : [sFar, edge];
        placeRow(s0, s1, "single", dir === 1 ? -1 : 1, dir * (row + 1));
      }
      edge = far + dir * aisle;
      row++;
    }
    const sFar = edge + dir * singleDepth;
    if (dir === 1 ? sFar <= maxY : sFar >= minY) {
      const [s0, s1] = dir === 1 ? [edge, sFar] : [sFar, edge];
      placeRow(s0, s1, "single", dir === 1 ? -1 : 1, dir * (row + 1));
    }
  };
  side(1);
  side(-1);
  return { groups };
}

/** A meeting table sized to a meeting room, with its clearance all round. */
function furnishMeetingRoom(level: Plan, room: Room, rules: LayoutRules): Item | null {
  const frame: Frame = { origin: room.points[0], angle: longAxis(room.points) };
  const loc = room.points.map((p) => toLocal(frame, p));
  const inset = Math.max(0, ...level.walls.map((w) => w.thickness)) / 2;
  const minX = Math.min(...loc.map((p) => p.x)) + inset;
  const maxX = Math.max(...loc.map((p) => p.x)) - inset;
  const minY = Math.min(...loc.map((p) => p.y)) + inset;
  const maxY = Math.max(...loc.map((p) => p.y)) - inset;
  const wallById = new Map(level.walls.map((w) => [w.id, w]));
  const doorZones = level.openings
    .filter((o) => o.kind === "door" && wallById.has(o.wallId))
    .map((o) => doorZone(wallById.get(o.wallId)!, o, rules.doorClearance));
  const fits = (box: Box) => {
    const zone = { ...box, w: box.w + 2 * rules.tableClearance, d: box.d + 2 * rules.tableClearance };
    // The clearance may share floor with a door's, but the table and its chairs stay out of it.
    const seated = { ...box, w: box.w + 900, d: box.d + 900 };
    return corners(zone).every((p) => pointInPolygon(p, room.points)) && !doorZones.some((z) => boxesOverlap(seated, z, 20));
  };
  const width = maxX - minX - 2 * rules.tableClearance;
  const depth = Math.min(1_200, maxY - minY - 2 * rules.tableClearance);
  // The middle of the room first, then nudged away from a door, nearest spots first.
  const spots: Point[] = [];
  for (let dx = -1_500; dx <= 1_500; dx += 250) for (let dy = -1_500; dy <= 1_500; dy += 250) spots.push({ x: dx, y: dy });
  spots.sort((a, b) => Math.hypot(a.x, a.y) - Math.hypot(b.x, b.y));
  const at = (o: Point) => toWorld(frame, { x: (minX + maxX) / 2 + o.x, y: (minY + maxY) / 2 + o.y });
  for (let w = Math.min(6_000, Math.floor(width / 100) * 100); w >= 1_400; w -= 200) {
    const d = Math.floor(depth / 100) * 100;
    if (d < 800) break;
    for (const o of spots) {
      const c = at(o);
      if (fits({ c, w, d, angle: frame.angle })) {
        return { id: newId(), levelId: room.levelId, type: "meeting-table", at: c, width: w, depth: d, rotation: normal(frame.angle) };
      }
    }
  }
  for (const r of [1_200, 1_000, 900]) {
    for (const o of spots) {
      const c = at(o);
      if (fits({ c, w: r, d: r, angle: 0 })) return { id: newId(), levelId: room.levelId, type: "round-table", at: c, width: r, depth: r, rotation: 0 };
    }
  }
  return null;
}

/** Orders in which teams could be handed desks, to try against the near and apart pairs. */
function teamOrders(departments: Department[], pairs: Adjacency[]): Department[][] {
  const orders: Department[][] = [departments];
  const names = departments.map((d) => d.name.toLowerCase());
  const linked = (a: string, b: string, kind: "near" | "apart") =>
    pairs.some((p) => p.kind === kind && ((p.a.toLowerCase() === a && p.b.toLowerCase() === b) || (p.a.toLowerCase() === b && p.b.toLowerCase() === a)));
  // Chains that start from each team and take next the team most linked to the last one.
  for (let s = 0; s < departments.length && orders.length < 12; s++) {
    const left = departments.map((_, i) => i).filter((i) => i !== s);
    const chain = [s];
    while (left.length) {
      const last = names[chain[chain.length - 1]];
      left.sort((a, b) => {
        const score = (i: number) => (linked(last, names[i], "near") ? 2 : 0) - (linked(last, names[i], "apart") ? 2 : 0);
        return score(b) - score(a);
      });
      chain.push(left.shift()!);
    }
    orders.push(chain.map((i) => departments[i]));
  }
  return orders;
}

/** Hands seats to teams in order, labelling each desk with its team and number. */
function assign(seats: Group["seats"], order: Department[], needed: number | null): Group["seats"] {
  const out: Group["seats"] = [];
  if (!order.length) return needed == null ? seats : seats.slice(0, needed);
  let s = 0;
  for (const dept of order) {
    for (let n = 1; n <= dept.headcount && s < seats.length; n++, s++) {
      const { desk, chair } = seats[s];
      out.push({ desk: { ...desk, label: `${dept.name} ${n}` }, chair });
    }
  }
  // Seats past the teams' total, up to the headcount, stay free for growth.
  const extra = Math.max(0, (needed ?? 0) - out.length);
  for (let n = 1; n <= extra && s < seats.length; n++, s++) {
    const { desk, chair } = seats[s];
    out.push({ desk: { ...desk, label: `Spare ${n}` }, chair });
  }
  return out;
}

/**
 * Groups in the order teams are handed them: from one end of the floor, each
 * next group the nearest one not yet taken, so a team's desks stay together.
 */
function chain(groups: Group[]): Group[] {
  if (!groups.length) return [];
  const centre = (g: Group) => {
    const n = g.seats.length;
    return { x: g.seats.reduce((s, t) => s + t.desk.at.x, 0) / n, y: g.seats.reduce((s, t) => s + t.desk.at.y, 0) / n };
  };
  const left = groups.map((g) => ({ g, c: centre(g) })).sort((a, b) => a.g.order[0] - b.g.order[0] || a.g.order[1] - b.g.order[1]);
  const out = [left.shift()!];
  while (left.length) {
    const last = out[out.length - 1].c;
    let best = 0;
    for (let i = 1; i < left.length; i++) {
      if (Math.hypot(left[i].c.x - last.x, left[i].c.y - last.y) < Math.hypot(left[best].c.x - last.x, left[best].c.y - last.y)) best = i;
    }
    out.push(left.splice(best, 1)[0]);
  }
  return out.map((x) => x.g);
}

function signature(items: Item[]): string {
  return items
    .filter((i) => DESK_TYPES.has(i.type))
    .map((i) => `${Math.round(i.at.x / 100)},${Math.round(i.at.y / 100)}`)
    .sort()
    .join(";");
}

/** Lays out options for a floor of the plan. Pure: the plan is not changed. */
export function generateLayouts(plan: Plan, levelId: string, input: GenerateInput, now = new Date()): GenerateResult {
  const level = onLevel(plan, levelId);
  const { rules } = input;
  const usable = level.rooms.filter((r) => r.usable);
  if (!usable.length) {
    return { ok: false, error: "Mark the rooms on this floor first: use the Room tool in the plan editor, then come back." };
  }
  let work = usable.filter(isWorkRoom);
  const notes: string[] = [];
  if (!work.length) {
    const largest = [...usable].sort((a, b) => polygonArea(b.points) - polygonArea(a.points))[0];
    work = [largest];
    notes.push(`No room is named as a work area, so desks go in the largest room, ${largest.name}.`);
  }
  const inWork = (i: Item) => work.some((r) => pointInPolygon(i.at, r.points));
  const kept = level.items.filter((i) => !((DESK_TYPES.has(i.type) || CHAIR_TYPES.has(i.type)) && inWork(i)));

  const teamTotal = input.departments.reduce((s, d) => s + d.headcount, 0);
  const needed = input.headcount != null || teamTotal ? Math.max(input.headcount ?? 0, teamTotal) : null;

  // Meeting rooms with nothing in them get a table.
  const tables: Item[] = [];
  for (const room of usable.filter((r) => MEETING.test(r.name))) {
    if (kept.some((i) => pointInPolygon(i.at, room.points))) continue;
    const table = furnishMeetingRoom(level, room, rules);
    if (table) tables.push(table);
  }

  const strategies: Strategy[] = [];
  for (const angle of ["long", "cross"] as const) {
    for (const spine of ["middle", "door"] as const) {
      for (const group of [...rules.groupSizes].sort((a, b) => b - a).slice(0, 2)) strategies.push({ angle, spine, group });
    }
  }

  const candidates: (GeneratedOption & { strategy: Strategy; signature: string })[] = [];
  for (const strategy of strategies) {
    const groups = work.flatMap((room) => layOutRoom(level, room, kept, rules, strategy).groups);
    const seats = chain(groups).flatMap((g) => g.seats);
    if (!seats.length) continue;

    // Of the orders tried, keep the one that meets the most near and apart pairs.
    const orders = teamOrders(input.departments, input.adjacencies);
    let bestSeats: Group["seats"] = [];
    let bestMet = -1;
    for (const order of orders) {
      for (const list of [seats, [...seats].reverse()]) {
        const chosen = assign(list, order, needed);
        const { adjacencies } = teamsAndPairs(chosen.map((s) => s.desk), level.rooms, input.adjacencies, rules);
        const met = adjacencies.filter((a) => a.met).length;
        if (met > bestMet) {
          bestMet = met;
          bestSeats = chosen;
        }
      }
    }

    // Check, take out any desk the checker flags, and check again.
    let items = [...kept, ...tables, ...bestSeats.flatMap((s) => [s.desk, s.chair])];
    let report = checkLayout({ ...level, items }, { rules, headcount: needed, adjacencies: input.adjacencies });
    for (let pass = 0; pass < 3; pass++) {
      const flagged = new Set(report.issues.flatMap((i) => i.itemIds));
      const drop = bestSeats.filter((s) => flagged.has(s.desk.id) || flagged.has(s.chair.id));
      if (!drop.length) break;
      const gone = new Set(drop.flatMap((s) => [s.desk.id, s.chair.id]));
      bestSeats = bestSeats.filter((s) => !gone.has(s.desk.id));
      items = items.filter((i) => !gone.has(i.id));
      report = checkLayout({ ...level, items }, { rules, headcount: needed, adjacencies: input.adjacencies });
    }
    if (!bestSeats.length) continue;
    candidates.push({
      strategy,
      signature: signature(items),
      capacity: seats.length,
      report,
      option: {
        id: newId(),
        name: "",
        levelId,
        createdAt: now.toISOString(),
        summary: "",
        ruleSetName: input.ruleSetName,
        rules,
        headcount: needed,
        departments: input.departments,
        adjacencies: input.adjacencies,
        items,
      },
    });
  }
  if (!candidates.length) {
    return {
      ok: false,
      error: `No desks fit in ${work.map((r) => r.name).join(" or ")} with these rules. Check the rooms are drawn, or ease the clearances.`,
    };
  }

  // The best few that differ from each other.
  candidates.sort((a, b) => b.report.metrics.score - a.report.metrics.score || b.report.metrics.desks - a.report.metrics.desks);
  const picked: typeof candidates = [];
  for (const c of candidates) {
    if (picked.length >= 5) break;
    if (picked.some((p) => p.signature === c.signature)) continue;
    picked.push(c);
  }
  if (picked.length < 3) notes.push(`Only ${picked.length} different layout${picked.length === 1 ? "" : "s"} fit this floor.`);

  const letters = "ABCDE";
  return {
    ok: true,
    notes,
    options: picked.map((c, i) => {
      const { strategy, capacity, report } = c;
      const desks = report.metrics.desks;
      const fit =
        needed == null
          ? `${desks} desks.`
          : desks >= needed
            ? `${desks} desks for ${needed} people${capacity > desks ? `, with room for ${capacity}` : ""}.`
            : `${desks} desks for ${needed} people: ${needed - desks} short.`;
      const summary = `Groups of up to ${strategy.group}, ${STRATEGY_WORDS[strategy.angle]}, ${STRATEGY_WORDS[strategy.spine]}. ${fit}`;
      return { option: { ...c.option, name: `Option ${letters[i]}`, summary }, report, capacity };
    }),
  };
}
