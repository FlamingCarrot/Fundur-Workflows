import { distance, itemName, pointInPolygon, polygonArea, type Item, type Plan, type Point, type Room } from "@/lib/plan/geometry";
import { matchName, type Adjacency, type LayoutRules } from "./rules";
import {
  DOOR,
  FURNITURE,
  Grid,
  INSIDE,
  SOLID,
  boxesOverlap,
  columnBox,
  doorPoint,
  doorZone,
  itemBox,
  local,
  wallBoxes,
  type Box,
} from "./space";

/**
 * Checks furniture on one floor against the layout rules (P4-02, P4-04): no
 * overlaps, room for every chair, doors and columns kept clear, a route of
 * the aisle width to every desk and of the main-route width between the
 * doors, and walking distances within the limit. It also measures the floor
 * (P4-03) so options can be scored and compared.
 *
 * It runs on every edit while an option is open, so it is written to stay
 * well under a frame for a few hundred items.
 */

export const DESK_TYPES = new Set(["desk", "desk-chair", "desk-l"]);
export const CHAIR_TYPES = new Set(["office-chair", "chair"]);
export const TABLE_TYPES = new Set(["meeting-table", "round-table"]);
/** Lies on the floor: walked over, never in the way. */
const FLAT_TYPES = new Set(["rug"]);

export type IssueKind = "overlap" | "wall" | "column" | "door" | "chair" | "table" | "route" | "main-route" | "travel" | "doors";

export interface LayoutIssue {
  kind: IssueKind;
  message: string;
  /** The items it is about, to highlight them. */
  itemIds: string[];
}

export interface AdjacencyResult extends Adjacency {
  met: boolean;
  /** Between the closest desks or room edges, in mm; null when one side is not on this floor. */
  distance: number | null;
}

export interface TeamResult {
  name: string;
  desks: number;
  together: boolean;
}

export interface ScorePart {
  label: string;
  points: number;
  max: number;
}

export interface LayoutMetrics {
  desks: number;
  headcount: number | null;
  /** m², every usable room on the floor. */
  usableArea: number;
  /** m², the rooms that hold desks (or every usable room when none do). */
  workArea: number;
  /** m² of usable floor per desk. */
  areaPerDesk: number | null;
  /** Share of the work area that is neither under furniture nor its chair space, 0 to 1. */
  circulation: number;
  /** The longest walk from a desk to the nearest door, in mm; null with no desks or no doors. */
  longestWalk: number | null;
  adjacencies: AdjacencyResult[];
  teams: TeamResult[];
  score: number;
  scoreParts: ScorePart[];
}

export interface LayoutReport {
  issues: LayoutIssue[];
  metrics: LayoutMetrics;
}

export interface CheckInput {
  rules: LayoutRules;
  headcount: number | null;
  adjacencies: Adjacency[];
}

/** The team a desk belongs to, from its label: "Finance 3" is in Finance. */
export function teamOf(item: Item): string | null {
  if (!DESK_TYPES.has(item.type) || !item.label) return null;
  const name = item.label.replace(/\s+\d+$/, "").trim();
  return name || null;
}

/** The space behind a desk where its chair goes: the desk's own -y side, as the library draws a chair. */
export function chairZone(item: Item, rules: LayoutRules): Box {
  const zone = local(itemBox(item), 0, -(item.depth / 2 + rules.chairSpace / 2));
  return { c: zone, w: item.width, d: rules.chairSpace, angle: item.rotation };
}

const grow = (box: Box, by: number): Box => ({ ...box, w: box.w + 2 * by, d: box.d + 2 * by });

function pointToPolygon(p: Point, points: Point[]): number {
  if (pointInPolygon(p, points)) return 0;
  let best = Infinity;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
    best = Math.min(best, distance(p, { x: a.x + t * dx, y: a.y + t * dy }));
  }
  return best;
}

/** A team's desks or a room, whichever the name points at on this floor. */
type Place = { points: Point[]; room?: Room };

function placeOf(name: string, teams: Map<string, Point[]>, rooms: Room[]): Place | null {
  const team = matchName(name, [...teams.keys()]);
  if (team) return { points: teams.get(team)! };
  const roomName = matchName(name, rooms.map((r) => r.name));
  const room = roomName ? rooms.find((r) => r.name === roomName) : undefined;
  return room ? { points: room.points, room } : null;
}

function placeDistance(a: Place, b: Place): number {
  let best = Infinity;
  if (a.room && b.room) {
    for (const p of a.points) best = Math.min(best, pointToPolygon(p, b.points));
    for (const p of b.points) best = Math.min(best, pointToPolygon(p, a.points));
    return best;
  }
  if (a.room || b.room) {
    const room = (a.room ? a : b).points;
    for (const p of (a.room ? b : a).points) best = Math.min(best, pointToPolygon(p, room));
    return best;
  }
  for (const p of a.points) for (const q of b.points) best = Math.min(best, distance(p, q));
  return best;
}

/** True when every desk of a team can be reached from another of its desks by short steps. */
function together(points: Point[], step: number): boolean {
  if (points.length < 2) return true;
  const seen = new Set([0]);
  const queue = [0];
  while (queue.length) {
    const i = queue.pop()!;
    for (let j = 0; j < points.length; j++) {
      if (!seen.has(j) && distance(points[i], points[j]) <= step) {
        seen.add(j);
        queue.push(j);
      }
    }
  }
  return seen.size === points.length;
}

/** Whether each team's desks sit together, and whether each near or apart pair is met. */
export function teamsAndPairs(
  desks: Item[],
  rooms: Room[],
  pairs: Adjacency[],
  rules: LayoutRules
): { teams: TeamResult[]; adjacencies: AdjacencyResult[] } {
  const teams = new Map<string, Point[]>();
  for (const d of desks) {
    const t = teamOf(d);
    if (t) teams.set(t, [...(teams.get(t) ?? []), d.at]);
  }
  const step = Math.max(rules.deskWidth, 2 * rules.deskDepth + 2 * rules.chairSpace) + rules.aisle + 200;
  return {
    teams: [...teams].map(([name, points]) => ({ name, desks: points.length, together: together(points, step) })),
    adjacencies: pairs.map((p) => {
      const a = placeOf(p.a, teams, rooms);
      const b = placeOf(p.b, teams, rooms);
      if (!a || !b) return { ...p, met: false, distance: null };
      const d = placeDistance(a, b);
      return { ...p, distance: d, met: p.kind === "near" ? d <= rules.nearWithin : d >= rules.apartBeyond };
    }),
  };
}

const m = (mmValue: number) => `${(mmValue / 1_000).toLocaleString("en-ZA", { maximumFractionDigits: 1 })} m`;

/** Checks and measures the furniture on one floor. `level` is the plan cut to that floor (onLevel). */
export function checkLayout(level: Plan, input: CheckInput): LayoutReport {
  const { rules } = input;
  const items = level.items.filter((i) => !FLAT_TYPES.has(i.type));
  const issues: LayoutIssue[] = [];
  const boxes = new Map(items.map((i) => [i.id, itemBox(i)]));
  const walls = level.walls.flatMap((w) => wallBoxes(w, level.openings));
  const wallById = new Map(level.walls.map((w) => [w.id, w]));
  const doors = level.openings.filter((o) => o.kind === "door" && wallById.has(o.wallId));
  const doorBoxes = doors.map((o) => doorZone(wallById.get(o.wallId)!, o, rules.doorClearance));
  const columns = level.columns.map((c) => columnBox(c));
  const columnZones = level.columns.map((c) => columnBox(c, rules.columnClearance));

  // Overlaps between pieces, except a chair pulled up to its desk or table.
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i];
      const b = items[j];
      const tucked =
        (CHAIR_TYPES.has(a.type) && (DESK_TYPES.has(b.type) || TABLE_TYPES.has(b.type))) ||
        (CHAIR_TYPES.has(b.type) && (DESK_TYPES.has(a.type) || TABLE_TYPES.has(a.type)));
      if (tucked) continue;
      if (boxesOverlap(boxes.get(a.id)!, boxes.get(b.id)!)) {
        issues.push({ kind: "overlap", message: `${itemName(a)} overlaps ${itemName(b)}`, itemIds: [a.id, b.id] });
      }
    }
  }

  for (const item of items) {
    const box = boxes.get(item.id)!;
    const name = itemName(item);
    if (walls.some((w) => boxesOverlap(box, w))) issues.push({ kind: "wall", message: `${name} runs into a wall`, itemIds: [item.id] });
    if (columns.some((c) => boxesOverlap(box, c))) issues.push({ kind: "column", message: `${name} runs into a column`, itemIds: [item.id] });
    else if (rules.columnClearance > 0 && columnZones.some((c) => boxesOverlap(box, c))) {
      issues.push({ kind: "column", message: `${name} is closer than ${rules.columnClearance} mm to a column`, itemIds: [item.id] });
    }
    if (doorBoxes.some((d) => boxesOverlap(box, d))) {
      issues.push({ kind: "door", message: `${name} is in the ${rules.doorClearance} mm kept clear in front of a door`, itemIds: [item.id] });
    }
    // Only a plain desk leaves its chair to the rules; the others draw their own.
    if (item.type === "desk") {
      const zone = chairZone(item, rules);
      const blocked =
        walls.some((w) => boxesOverlap(zone, w, 20)) ||
        columns.some((c) => boxesOverlap(zone, c, 20)) ||
        items.some((o) => o.id !== item.id && !CHAIR_TYPES.has(o.type) && boxesOverlap(zone, boxes.get(o.id)!, 20));
      if (blocked) issues.push({ kind: "chair", message: `${name} has less than ${rules.chairSpace} mm behind it for the chair`, itemIds: [item.id] });
    }
    if (TABLE_TYPES.has(item.type)) {
      const zone = grow(box, rules.tableClearance);
      const blocked =
        walls.some((w) => boxesOverlap(zone, w, 20)) ||
        columns.some((c) => boxesOverlap(zone, c, 20)) ||
        items.some((o) => o.id !== item.id && !CHAIR_TYPES.has(o.type) && boxesOverlap(zone, boxes.get(o.id)!, 20));
      if (blocked) issues.push({ kind: "table", message: `${name} has less than ${rules.tableClearance} mm around it`, itemIds: [item.id] });
    }
  }

  // ---- Routes and walking distances, on a grid over the floor.
  const desks = items.filter((i) => DESK_TYPES.has(i.type));
  const usableRooms = level.rooms.filter((r) => r.usable);
  const workRooms = usableRooms.filter((r) => desks.some((d) => pointInPolygon(d.at, r.points)));
  const extent = [
    ...level.walls.flatMap((w) => [w.a, w.b]),
    ...level.rooms.flatMap((r) => r.points),
    ...items.flatMap((i) => [{ x: i.at.x - i.width, y: i.at.y - i.width }, { x: i.at.x + i.width, y: i.at.y + i.width }]),
  ];
  let longestWalk: number | null = null;
  let circulation = 0;
  if (extent.length) {
    const grid = Grid.around({ origin: { x: 0, y: 0 }, angle: 0 }, extent, 2_000);
    const { cells } = grid;
    if (level.rooms.length) for (const r of level.rooms) grid.markPolygon(r.points, INSIDE);
    else cells.fill(INSIDE);
    for (const w of walls) grid.markBox(w, SOLID);
    for (const c of columns) grid.markBox(c, SOLID);
    for (const i of items) grid.markBox(boxes.get(i.id)!, FURNITURE);
    for (const d of doorBoxes) grid.markBox(d, DOOR);

    const walkable = (k: number) => (cells[k] & (INSIDE | DOOR)) !== 0 && (cells[k] & (SOLID | FURNITURE)) === 0;
    const clear = grid.clearance((f) => (f & (INSIDE | DOOR)) !== 0 && (f & (SOLID | FURNITURE)) === 0);
    const doorCells = doorBoxes.map((b) => grid.cellsOf(b).filter(walkable));
    const seeds = doorCells.flat();
    const slack = grid.cell / 2;
    const roomy = (width: number) => (k: number) => walkable(k) && ((cells[k] & DOOR) !== 0 || clear[k] >= width / 2 - slack);

    if (desks.length && !doors.length) {
      issues.push({ kind: "doors", message: "There are no doors on this floor, so the ways out cannot be checked", itemIds: [] });
    } else if (doors.length) {
      const dist = grid.walk(seeds, roomy(rules.aisle));
      const cut: Item[] = [];
      for (const item of [...desks, ...items.filter((i) => TABLE_TYPES.has(i.type))]) {
        const reach =
          item.type === "desk"
            ? grow(chairZone(item, rules), rules.aisle)
            : grow(boxes.get(item.id)!, (TABLE_TYPES.has(item.type) ? rules.tableClearance : 0) + rules.aisle);
        let best = Infinity;
        for (const k of grid.cellsOf(reach)) if (dist[k] < best) best = dist[k];
        if (!Number.isFinite(best)) cut.push(item);
        else if (DESK_TYPES.has(item.type)) longestWalk = Math.max(longestWalk ?? 0, best);
      }
      for (const item of cut) {
        issues.push({ kind: "route", message: `No ${rules.aisle} mm wide way from ${itemName(item)} to a door`, itemIds: [item.id] });
      }
      if (longestWalk != null && longestWalk > rules.maxTravel) {
        const far = desks.filter((d) => {
          const zone = d.type === "desk" ? grow(chairZone(d, rules), rules.aisle) : grow(boxes.get(d.id)!, rules.aisle);
          return grid.cellsOf(zone).some((k) => dist[k] > rules.maxTravel && Number.isFinite(dist[k]));
        });
        issues.push({
          kind: "travel",
          message: `The walk to a door is ${m(longestWalk)} from the furthest desk, over the ${m(rules.maxTravel)} limit`,
          itemIds: far.map((d) => d.id),
        });
      }

      // The main route: every door into a room with desks reaches the others at the main-route width.
      const served = doors
        .map((o, i) => ({ o, i, at: doorPoint(wallById.get(o.wallId)!, o) }))
        .filter(({ o, at }) => {
          const off = wallById.get(o.wallId)!.thickness / 2 + 200;
          return workRooms.some(
            (r) =>
              pointInPolygon({ x: at.at.x + at.normal.x * off, y: at.at.y + at.normal.y * off }, r.points) ||
              pointInPolygon({ x: at.at.x - at.normal.x * off, y: at.at.y - at.normal.y * off }, r.points)
          );
        });
      if (served.length > 1) {
        const main = grid.walk(doorCells[served[0].i], roomy(rules.mainRoute));
        const unreached = served.slice(1).filter(({ i }) => !doorCells[i].some((k) => Number.isFinite(main[k])));
        if (unreached.length) {
          issues.push({
            kind: "main-route",
            message: `The main route between the doors is narrower than ${rules.mainRoute} mm somewhere (${unreached.length} door${unreached.length === 1 ? "" : "s"} cut off)`,
            itemIds: [],
          });
        }
      }
    }

    // Circulation: the work rooms' floor that is neither under furniture nor its chair space.
    const occupied = new Uint8Array(cells.length);
    for (const i of items) for (const k of grid.cellsOf(boxes.get(i.id)!)) occupied[k] = 1;
    for (const d of desks) if (d.type === "desk") for (const k of grid.cellsOf(chairZone(d, rules))) occupied[k] = 1;
    const area = new Uint8Array(cells.length);
    for (const r of workRooms.length ? workRooms : usableRooms) grid.each(r.points, (q) => pointInPolygon(q, r.points), (k) => (area[k] = 1));
    let floor = 0;
    let free = 0;
    for (let k = 0; k < cells.length; k++) {
      if (!area[k] || cells[k] & SOLID) continue;
      floor++;
      if (!occupied[k]) free++;
    }
    circulation = floor ? free / floor : 0;
  }

  // ---- Teams and who sits near whom.
  const { teams: teamResults, adjacencies } = teamsAndPairs(desks, level.rooms, input.adjacencies, rules);

  const usable = usableRooms.reduce((s, r) => s + polygonArea(r.points), 0) / 1e6;
  const work = (workRooms.length ? workRooms : usableRooms).reduce((s, r) => s + polygonArea(r.points), 0) / 1e6;
  const metrics: Omit<LayoutMetrics, "score" | "scoreParts"> = {
    desks: desks.length,
    headcount: input.headcount,
    usableArea: usable,
    workArea: work,
    areaPerDesk: desks.length ? usable / desks.length : null,
    circulation,
    longestWalk: desks.length && doors.length ? longestWalk : null,
    adjacencies,
    teams: teamResults,
  };
  const scoreParts = scoreOf(metrics, issues);
  return { issues, metrics: { ...metrics, scoreParts, score: Math.round(scoreParts.reduce((s, p) => s + p.points, 0)) } };
}

/**
 * The score out of 100, in parts so the compare screen can show where an
 * option gains and loses: seats for the headcount (40), clearances (25), who
 * sits near whom (15), teams kept together (10) and circulation between 30%
 * and 50% of the floor (10).
 */
export function scoreOf(metrics: Omit<LayoutMetrics, "score" | "scoreParts">, issues: LayoutIssue[]): ScorePart[] {
  const round = (n: number) => Math.round(n * 10) / 10;
  const seats = metrics.headcount ? Math.min(metrics.desks / metrics.headcount, 1) : metrics.desks ? 1 : 0;
  const clearances = Math.max(0, 25 - 5 * issues.length);
  const adj = metrics.adjacencies.length ? metrics.adjacencies.filter((a) => a.met).length / metrics.adjacencies.length : 1;
  const teams = metrics.teams.length ? metrics.teams.filter((t) => t.together).length / metrics.teams.length : 1;
  const c = metrics.circulation;
  const circ = c >= 0.3 && c <= 0.5 ? 1 : Math.max(0, 1 - (c < 0.3 ? 0.3 - c : c - 0.5) * 5);
  return [
    { label: "Seats for the headcount", points: round(40 * seats), max: 40 },
    { label: "Clearances met", points: round(clearances), max: 25 },
    { label: "Near and apart", points: round(15 * adj), max: 15 },
    { label: "Teams kept together", points: round(10 * teams), max: 10 },
    { label: "Circulation 30 to 50%", points: round(10 * circ), max: 10 },
  ];
}
