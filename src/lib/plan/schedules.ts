import { DEFAULTS, levelOf, roomArea, wallLength, type Plan, type PlanItem } from "./geometry";
import { sortedLevels } from "./elements";
import { blueprintFor, STANDARD, type Resolver } from "@/lib/blueprints/resolve";
import { itemHeight } from "@/lib/blueprints/symbol";

/**
 * Schedules: the quantity lists a fit-out is priced, ordered and checked from,
 * counted from the plan itself (Revit's View > Schedules). Furniture is grouped
 * by blueprint, size and finish; rooms list their areas and floor finishes;
 * doors and windows group by kind and size; walls total their length and face
 * area by type. Each row keeps the things it counts, so picking a row selects
 * them on the plan.
 */

export type ScheduleKind = "furniture" | "rooms" | "openings" | "walls";

export const SCHEDULES: { kind: ScheduleKind; label: string }[] = [
  { kind: "furniture", label: "Furniture" },
  { kind: "rooms", label: "Rooms" },
  { kind: "openings", label: "Doors and windows" },
  { kind: "walls", label: "Walls" },
];

export interface ScheduleColumn {
  key: string;
  label: string;
  /** Numbers line up on the right and are totalled. */
  numeric?: boolean;
  /** Summed in the total row. */
  total?: boolean;
}

export type Cell = string | number;

export interface ScheduleRow {
  key: string;
  cells: Record<string, Cell>;
  targets: PlanItem[];
}

export interface Schedule {
  kind: ScheduleKind;
  title: string;
  columns: ScheduleColumn[];
  rows: ScheduleRow[];
  totals: Record<string, number>;
}

const round = (n: number, places = 2) => Math.round(n * 10 ** places) / 10 ** places;
const m = (mm: number) => round(mm / 1_000);

/** A schedule of one floor, or of every floor when no floor is given. */
export function schedule(plan: Plan, kind: ScheduleKind, lib: Resolver = STANDARD, levelId?: string): Schedule {
  const levels = sortedLevels(plan).filter((l) => !levelId || l.id === levelId);
  const here = new Set(levels.map((l) => l.id));
  const floorName = (id: string) => levelOf(plan, id).name;
  const groups = new Map<string, ScheduleRow>();
  const add = (key: string, cells: Record<string, Cell>, target: PlanItem, sum: Record<string, number> = {}) => {
    const row = groups.get(key);
    if (!row) {
      groups.set(key, { key, cells: { ...cells, ...sum }, targets: [target] });
      return;
    }
    row.targets.push(target);
    for (const [k, v] of Object.entries(sum)) row.cells[k] = round(Number(row.cells[k] ?? 0) + v);
    if (cells.floors && !String(row.cells.floors).split(", ").includes(String(cells.floors))) row.cells.floors = `${row.cells.floors}, ${cells.floors}`;
  };
  let columns: ScheduleColumn[] = [];
  let title = "";

  if (kind === "furniture") {
    title = "Furniture schedule";
    columns = [
      { key: "name", label: "Item" },
      { key: "size", label: "Size (mm)" },
      { key: "finish", label: "Finish" },
      { key: "floors", label: "Floors" },
      { key: "count", label: "Count", numeric: true, total: true },
    ];
    for (const it of plan.items) {
      if (!here.has(it.levelId)) continue;
      const bp = blueprintFor(lib, it);
      const size = `${Math.round(it.width)} × ${Math.round(it.depth)} × ${Math.round(itemHeight(lib, it))}`;
      const finish = it.material ? (lib.material(it.material)?.name ?? "Missing material") : "As designed";
      add(`${bp.id}|${size}|${finish}`, { name: bp.name, size, finish, floors: floorName(it.levelId) }, { kind: "item", id: it.id }, { count: 1 });
    }
  }

  if (kind === "rooms") {
    title = "Room schedule";
    columns = [
      { key: "name", label: "Room" },
      { key: "floors", label: "Floor" },
      { key: "area", label: "Area (m²)", numeric: true, total: true },
      { key: "perimeter", label: "Perimeter (m)", numeric: true, total: true },
      { key: "finish", label: "Floor finish" },
      { key: "usable", label: "Counts as usable" },
    ];
    for (const r of plan.rooms) {
      if (!here.has(r.levelId)) continue;
      const perimeter = r.points.reduce((sum, p, i) => sum + Math.hypot(r.points[(i + 1) % r.points.length].x - p.x, r.points[(i + 1) % r.points.length].y - p.y), 0);
      add(
        r.id,
        { name: r.name, floors: floorName(r.levelId), finish: r.floorMaterial ? (lib.material(r.floorMaterial)?.name ?? "Missing material") : "Not set", usable: r.usable ? "Yes" : "No" },
        { kind: "room", id: r.id },
        { area: round(roomArea(r)), perimeter: m(perimeter) },
      );
    }
  }

  if (kind === "openings") {
    title = "Door and window schedule";
    columns = [
      { key: "kind", label: "Type" },
      { key: "size", label: "Width × height (mm)" },
      { key: "sill", label: "Sill (mm)" },
      { key: "floors", label: "Floors" },
      { key: "count", label: "Count", numeric: true, total: true },
    ];
    const walls = new Map(plan.walls.map((w) => [w.id, w]));
    for (const o of plan.openings) {
      const wall = walls.get(o.wallId);
      if (!wall || !here.has(wall.levelId)) continue;
      const door = o.kind === "door";
      const style = door ? ({ single: "Single door", double: "Double door", sliding: "Sliding door", opening: "Opening, no door" } as const)[o.style ?? "single"] : "Window";
      const height = o.height ?? (door ? DEFAULTS.doorHeight : DEFAULTS.windowHeight);
      const size = `${Math.round(o.width)} × ${Math.round(height)}`;
      const sill = door ? "" : String(Math.round(o.sill ?? DEFAULTS.windowSill));
      add(`${style}|${size}|${sill}`, { kind: style, size, sill, floors: floorName(wall.levelId) }, { kind: "opening", id: o.id }, { count: 1 });
    }
  }

  if (kind === "walls") {
    title = "Wall schedule";
    columns = [
      { key: "name", label: "Wall type" },
      { key: "thickness", label: "Thickness (mm)" },
      { key: "floors", label: "Floors" },
      { key: "count", label: "Walls", numeric: true, total: true },
      { key: "length", label: "Length (m)", numeric: true, total: true },
      { key: "area", label: "One face (m²)", numeric: true, total: true },
    ];
    for (const w of plan.walls) {
      if (!here.has(w.levelId)) continue;
      const type = w.typeId ? lib.blueprint(w.typeId) : undefined;
      const name = type?.name ?? (w.kind === "partition" ? "Partition (no type)" : "Wall (no type)");
      const length = wallLength(w);
      const height = w.height ?? levelOf(plan, w.levelId).height;
      const openings = plan.openings.filter((o) => o.wallId === w.id).reduce((sum, o) => sum + o.width * Math.min(height, o.height ?? (o.kind === "door" ? DEFAULTS.doorHeight : DEFAULTS.windowHeight)), 0);
      add(
        `${type?.id ?? w.kind}|${w.thickness}`,
        { name, thickness: Math.round(w.thickness), floors: floorName(w.levelId) },
        { kind: "wall", id: w.id },
        { count: 1, length: m(length), area: round(Math.max(0, length * height - openings) / 1e6) },
      );
    }
  }

  const rows = [...groups.values()].sort((a, b) => String(a.cells[columns[0].key]).localeCompare(String(b.cells[columns[0].key])) || String(a.cells.floors ?? "").localeCompare(String(b.cells.floors ?? "")));
  const totals: Record<string, number> = {};
  for (const c of columns) if (c.total) totals[c.key] = round(rows.reduce((sum, r) => sum + Number(r.cells[c.key] ?? 0), 0));
  return { kind, title, columns, rows, totals };
}

/** The schedule as CSV, with a total line, for a spreadsheet or a supplier. */
export function scheduleCsv(s: Schedule): string {
  const cell = (v: Cell | undefined) => {
    const text = v === undefined ? "" : String(v);
    // A leading = + - @ would run as a formula in a spreadsheet.
    const safe = /^[=+\-@]/.test(text) && typeof v !== "number" ? `'${text}` : text;
    return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  const lines = [s.columns.map((c) => cell(c.label)).join(",")];
  for (const r of s.rows) lines.push(s.columns.map((c) => cell(r.cells[c.key])).join(","));
  if (s.rows.length && Object.keys(s.totals).length) lines.push(s.columns.map((c, i) => (i === 0 ? "Total" : c.key in s.totals ? String(s.totals[c.key]) : "")).join(","));
  return lines.join("\r\n") + "\r\n";
}

/** The schedule as plain lines, for the assistant. */
export function scheduleText(s: Schedule): string {
  if (!s.rows.length) return `${s.title}: nothing on the plan yet.`;
  return [
    `${s.title} (${s.columns.map((c) => c.label).join(" | ")}):`,
    ...s.rows.map((r) => `- ${s.columns.map((c) => r.cells[c.key] ?? "").join(" | ")}`),
    Object.keys(s.totals).length ? `Total: ${s.columns.filter((c) => c.key in s.totals).map((c) => `${c.label} ${s.totals[c.key]}`).join(", ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}
