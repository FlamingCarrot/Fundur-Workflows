import {
  addOpening,
  addRoom,
  centroid,
  emptyPlan,
  JOIN_MM,
  m2,
  newId,
  pointAlong,
  pointInPolygon,
  roomArea,
  samePoint,
  usableArea,
  wallLength,
  DEFAULTS,
  type Plan,
  type Point,
  type ReferenceLine,
  type Wall,
} from "./geometry";

/**
 * DXF in and out (P3-02 and P3-10).
 *
 * DXF is the open exchange format every CAD package reads and writes, and the
 * one DWG converters produce, so it is the first format the editor speaks.
 * Which other formats she receives is still to be settled by the format spike
 * (P3-01, docs/decisions/plan-formats.md); this file covers what a plain 2D
 * DXF carries.
 *
 * Reading: lines and polylines on wall layers become walls; closed polylines
 * on room or space layers become rooms, named by the text inside them; small
 * closed shapes on column layers become columns; lines on door and window
 * layers place openings on the wall they sit on. Everything else is kept as
 * faint reference lines, and anything the app cannot read yet is listed as a
 * warning rather than dropped silently.
 *
 * Writing: an AutoCAD R12 ASCII DXF in millimetres, the version every CAD
 * package still opens, with one layer each for walls, doors, windows, columns
 * and rooms.
 */

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

interface Pair {
  code: number;
  value: string;
}

function pairs(text: string): Pair[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const out: Pair[] = [];
  if (!/^\s*-?\d+\s*$/.test(lines[0] ?? "")) throw new Error("This is not a text DXF file. Save it from your CAD software as ASCII DXF.");
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = Number.parseInt(lines[i].trim(), 10);
    if (Number.isNaN(code)) throw new Error("This is not a text DXF file. Save it from your CAD software as ASCII DXF.");
    out.push({ code, value: lines[i + 1].trim() });
  }
  return out;
}

interface Entity {
  type: string;
  layer: string;
  /** Every group code and value in order; polylines repeat 10 and 20. */
  pairs: Pair[];
  vertices?: Point[];
  closed?: boolean;
}

function num(entity: Entity, code: number, fallback = 0): number {
  const p = entity.pairs.find((x) => x.code === code);
  const n = p ? Number.parseFloat(p.value) : Number.NaN;
  return Number.isFinite(n) ? n : fallback;
}

/** The header variables, sections and entities of a DXF file. */
function readSections(all: Pair[]): { header: Map<string, Pair[]>; entities: Entity[] } {
  const header = new Map<string, Pair[]>();
  const entities: Entity[] = [];
  let i = 0;
  while (i < all.length) {
    if (all[i].code === 0 && all[i].value === "SECTION" && all[i + 1]?.code === 2) {
      const name = all[i + 1].value;
      i += 2;
      if (name === "HEADER") {
        let variable = "";
        while (i < all.length && !(all[i].code === 0 && all[i].value === "ENDSEC")) {
          if (all[i].code === 9) {
            variable = all[i].value;
            header.set(variable, []);
          } else if (variable) header.get(variable)!.push(all[i]);
          i++;
        }
      } else if (name === "ENTITIES") {
        let current: Entity | null = null;
        while (i < all.length && !(all[i].code === 0 && all[i].value === "ENDSEC")) {
          if (all[i].code === 0) {
            current = { type: all[i].value, layer: "0", pairs: [] };
            entities.push(current);
          } else if (current) {
            if (all[i].code === 8) current.layer = all[i].value;
            current.pairs.push(all[i]);
          }
          i++;
        }
      } else {
        while (i < all.length && !(all[i].code === 0 && all[i].value === "ENDSEC")) i++;
      }
    }
    i++;
  }
  return { header, entities };
}

/** Joins old-style POLYLINE, VERTEX ... SEQEND runs into one entity with its vertices. */
function gatherPolylines(entities: Entity[]): Entity[] {
  const out: Entity[] = [];
  for (let i = 0; i < entities.length; i++) {
    const e = entities[i];
    if (e.type === "POLYLINE") {
      const vertices: Point[] = [];
      let j = i + 1;
      for (; j < entities.length && entities[j].type === "VERTEX"; j++) {
        vertices.push({ x: num(entities[j], 10), y: num(entities[j], 20) });
      }
      if (entities[j]?.type === "SEQEND") j++;
      out.push({ ...e, vertices, closed: (num(e, 70) & 1) === 1 });
      i = j - 1;
    } else if (e.type === "LWPOLYLINE") {
      const vertices: Point[] = [];
      let x: number | null = null;
      for (const p of e.pairs) {
        if (p.code === 10) x = Number.parseFloat(p.value);
        else if (p.code === 20 && x != null) {
          vertices.push({ x, y: Number.parseFloat(p.value) });
          x = null;
        }
      }
      out.push({ ...e, vertices, closed: (num(e, 70) & 1) === 1 });
    } else if (e.type !== "VERTEX" && e.type !== "SEQEND") {
      out.push(e);
    }
  }
  return out;
}

/** Millimetres per drawing unit, from $INSUNITS. */
const UNIT_SCALE: Record<number, { mm: number; name: string }> = {
  1: { mm: 25.4, name: "inches" },
  2: { mm: 304.8, name: "feet" },
  4: { mm: 1, name: "millimetres" },
  5: { mm: 10, name: "centimetres" },
  6: { mm: 1_000, name: "metres" },
};

const LAYER = {
  wall: /wall|mur|partition|a-wall/i,
  door: /door|deur/i,
  window: /window|venster|glaz/i,
  column: /col(umn)?s?\b|pillar|a-cols?/i,
  room: /room|space|area|zone|a-area/i,
};

export interface DxfImport {
  plan: Plan;
  warnings: string[];
}

/**
 * Reads a 2D DXF into plan geometry. Throws only when the file is not DXF at
 * all; everything else it cannot use comes back as a warning.
 */
export function importDxf(text: string, fileName = "plan.dxf"): DxfImport {
  const warnings: string[] = [];
  const { header, entities: raw } = readSections(pairs(text));
  if (!raw.length) throw new Error("No drawing found in this file. Check it is a DXF with something drawn in model space.");
  const entities = gatherPolylines(raw);

  const unitsCode = Number.parseInt(header.get("$INSUNITS")?.find((p) => p.code === 70)?.value ?? "0", 10);
  let scale = UNIT_SCALE[unitsCode]?.mm;
  if (!scale) {
    scale = 1;
    warnings.push("The file does not say what units it is drawn in, so millimetres were assumed. Check one known length.");
  } else if (scale !== 1) {
    warnings.push(`The file is drawn in ${UNIT_SCALE[unitsCode].name}; lengths were converted to millimetres.`);
  }
  const at = (p: Point): Point => ({ x: round(p.x * scale), y: round(p.y * scale) });

  const layers = new Set(entities.map((e) => e.layer));
  const hasWallLayer = [...layers].some((l) => LAYER.wall.test(l));
  if (!hasWallLayer) warnings.push("No layer is named for walls, so every line was read as a wall. Remove any that are not.");

  const segments: { a: Point; b: Point; layer: string }[] = [];
  const closedShapes: { points: Point[]; layer: string }[] = [];
  const texts: { at: Point; text: string; layer: string }[] = [];
  const skipped = new Map<string, number>();

  for (const e of entities) {
    switch (e.type) {
      case "LINE":
        segments.push({ a: at({ x: num(e, 10), y: num(e, 20) }), b: at({ x: num(e, 11), y: num(e, 21) }), layer: e.layer });
        break;
      case "LWPOLYLINE":
      case "POLYLINE": {
        const points = (e.vertices ?? []).map(at);
        if (points.length < 2) break;
        if (e.closed && points.length >= 3) closedShapes.push({ points, layer: e.layer });
        const edges = e.closed ? points.length : points.length - 1;
        for (let k = 0; k < edges; k++) segments.push({ a: points[k], b: points[(k + 1) % points.length], layer: e.layer });
        break;
      }
      case "TEXT":
      case "MTEXT": {
        const value = cleanText(e.pairs.filter((p) => p.code === 1 || p.code === 3).map((p) => p.value).join(""));
        if (value) texts.push({ at: at({ x: num(e, 10), y: num(e, 20) }), text: value, layer: e.layer });
        break;
      }
      default:
        skipped.set(e.type, (skipped.get(e.type) ?? 0) + 1);
    }
  }

  let plan = emptyPlan();
  const reference: ReferenceLine[] = [];

  // Rooms first, from closed shapes on room layers, named by the text inside.
  const roomShapes = closedShapes.filter((s) => LAYER.room.test(s.layer));
  const roomLayers = new Set(roomShapes.map((s) => s.layer));
  for (const shape of roomShapes) {
    const label = texts.find((t) => pointInPolygon(t.at, shape.points) && !/\d\s*(m²|m2)(?![a-z])|sq\.?\s*m(?![a-z])/i.test(t.text) && !/^usable area/i.test(t.text));
    const result = addRoom(plan, shape.points, label?.text);
    if (result.ok) plan = result.plan;
    else warnings.push(`A room outline on layer ${shape.layer} was skipped: ${result.error}`);
  }

  // Columns: small closed shapes on column layers.
  const columnShapes = closedShapes.filter((s) => LAYER.column.test(s.layer));
  const columnLayers = new Set(columnShapes.map((s) => s.layer));
  for (const shape of columnShapes) {
    const xs = shape.points.map((p) => p.x);
    const ys = shape.points.map((p) => p.y);
    const width = Math.max(...xs) - Math.min(...xs);
    const depth = Math.max(...ys) - Math.min(...ys);
    if (width > 0 && depth > 0 && width <= 5_000 && depth <= 5_000) {
      plan = {
        ...plan,
        columns: [...plan.columns, { id: newId(), at: { x: (Math.max(...xs) + Math.min(...xs)) / 2, y: (Math.max(...ys) + Math.min(...ys)) / 2 }, width, depth }],
      };
    }
  }

  // Walls, and the door and window lines to place on them afterwards.
  const openingLines: { a: Point; b: Point; kind: "door" | "window" }[] = [];
  const walls: Wall[] = [];
  for (const s of segments) {
    if (samePoint(s.a, s.b)) continue;
    if (roomLayers.has(s.layer) || columnLayers.has(s.layer)) continue;
    if (LAYER.door.test(s.layer) || LAYER.window.test(s.layer)) {
      openingLines.push({ ...s, kind: LAYER.door.test(s.layer) ? "door" : "window" });
      continue;
    }
    if (!hasWallLayer || LAYER.wall.test(s.layer)) {
      walls.push({ id: newId(), a: s.a, b: s.b, thickness: DEFAULTS.wallThickness });
    } else {
      reference.push({ a: s.a, b: s.b, layer: s.layer });
    }
  }
  plan = { ...plan, walls: mergeEnds(walls), reference };

  // A door or window line that runs along a wall marks an opening there.
  let placed = 0;
  for (const line of openingLines) {
    const length = Math.hypot(line.b.x - line.a.x, line.b.y - line.a.y);
    const mid = { x: (line.a.x + line.b.x) / 2, y: (line.a.y + line.b.y) / 2 };
    const wall = plan.walls
      .map((w) => ({ w, d: distanceToWall(w, mid) }))
      .filter((x) => x.d.off <= Math.max(x.w.thickness, 300) && parallel(x.w, line))
      .sort((p, q) => p.d.off - q.d.off)[0];
    if (!wall || length < 300) {
      plan = { ...plan, reference: [...plan.reference, { a: line.a, b: line.b, layer: line.kind }] };
      continue;
    }
    const result = addOpening(plan, wall.w.id, line.kind, wall.d.at, Math.min(length, 6_000));
    if (result.ok) {
      plan = result.plan;
      placed++;
    } else {
      plan = { ...plan, reference: [...plan.reference, { a: line.a, b: line.b, layer: line.kind }] };
    }
  }
  if (openingLines.length && placed < openingLines.length) {
    warnings.push(`${openingLines.length - placed} door or window line${openingLines.length - placed === 1 ? " was" : "s were"} kept for reference; place those openings on their walls.`);
  }

  for (const [type, count] of skipped) {
    const [one, many, why] =
      type === "INSERT"
        ? ["block", "blocks", "furniture, door symbols and other blocks are not read yet"]
        : type === "ARC" || type === "CIRCLE" || type === "ELLIPSE" || type === "SPLINE"
          ? ["curve", "curves", "only straight walls are supported so far"]
          : type === "DIMENSION"
            ? ["dimension", "dimensions", "the editor measures the walls itself"]
            : [`${type} entity`, `${type} entities`, "this kind of drawing item is not read"];
    warnings.push(`${count} ${count === 1 ? `${one} was` : `${many} were`} not read: ${why}.`);
  }
  if (!plan.walls.length) warnings.push("No walls were found. Check the file has its walls as lines or polylines.");

  return {
    plan: { ...plan, source: { name: fileName.slice(0, 255), format: "dxf", importedAt: new Date().toISOString(), warnings } },
    warnings,
  };
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

function cleanText(text: string): string {
  // MTEXT carries formatting codes such as \P (new line) and {\fArial;...}.
  return text
    .replace(/\\P/g, " ")
    .replace(/\\[A-Za-z][^;]*;/g, "")
    .replace(/[{}]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

/** Pulls wall ends that nearly meet onto one point, so the walls join. */
function mergeEnds(walls: Wall[]): Wall[] {
  const anchors: Point[] = [];
  const snap = (p: Point) => {
    const hit = anchors.find((q) => samePoint(p, q, Math.max(JOIN_MM, 2)));
    if (hit) return { ...hit };
    anchors.push(p);
    return p;
  };
  return walls.map((w) => ({ ...w, a: snap(w.a), b: snap(w.b) })).filter((w) => wallLength(w) > 0);
}

function distanceToWall(wall: Wall, p: Point): { at: number; off: number } {
  const len = wallLength(wall);
  const t = ((p.x - wall.a.x) * (wall.b.x - wall.a.x) + (p.y - wall.a.y) * (wall.b.y - wall.a.y)) / (len * len);
  const along = Math.max(0, Math.min(1, t)) * len;
  const q = pointAlong(wall, along);
  return { at: along, off: Math.hypot(p.x - q.x, p.y - q.y) };
}

function parallel(wall: Wall, line: { a: Point; b: Point }): boolean {
  const w = Math.atan2(wall.b.y - wall.a.y, wall.b.x - wall.a.x);
  const l = Math.atan2(line.b.y - line.a.y, line.b.x - line.a.x);
  const diff = Math.abs(((w - l + Math.PI * 2) % Math.PI));
  return diff < 0.05 || Math.abs(diff - Math.PI) < 0.05;
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

const OUT_LAYERS = [
  { name: "WALLS", colour: 7 },
  { name: "DOORS", colour: 1 },
  { name: "WINDOWS", colour: 5 },
  { name: "COLUMNS", colour: 8 },
  { name: "ROOMS", colour: 3 },
  { name: "ROOM-NAMES", colour: 3 },
  { name: "REFERENCE", colour: 9 },
];

function fmt(n: number): string {
  return (Math.round(n * 1000) / 1000).toString();
}

/** The corrected plan as an R12 DXF in millimetres, for her CAD software to carry on from. */
export function exportDxf(plan: Plan): string {
  const out: (string | number)[] = [];
  const g = (code: number, value: string | number) => out.push(code, value);

  g(0, "SECTION");
  g(2, "HEADER");
  g(9, "$ACADVER");
  g(1, "AC1009");
  g(9, "$INSUNITS");
  g(70, 4);
  g(0, "ENDSEC");

  g(0, "SECTION");
  g(2, "TABLES");
  g(0, "TABLE");
  g(2, "LAYER");
  g(70, OUT_LAYERS.length);
  for (const layer of OUT_LAYERS) {
    g(0, "LAYER");
    g(2, layer.name);
    g(70, 0);
    g(62, layer.colour);
    g(6, "CONTINUOUS");
  }
  g(0, "ENDTAB");
  g(0, "ENDSEC");

  g(0, "SECTION");
  g(2, "ENTITIES");
  const line = (layer: string, a: Point, b: Point) => {
    g(0, "LINE");
    g(8, layer);
    g(10, fmt(a.x));
    g(20, fmt(a.y));
    g(30, 0);
    g(11, fmt(b.x));
    g(21, fmt(b.y));
    g(31, 0);
  };
  const polyline = (layer: string, points: Point[]) => {
    g(0, "POLYLINE");
    g(8, layer);
    g(66, 1);
    g(10, 0);
    g(20, 0);
    g(30, 0);
    g(70, 1);
    for (const p of points) {
      g(0, "VERTEX");
      g(8, layer);
      g(10, fmt(p.x));
      g(20, fmt(p.y));
      g(30, 0);
    }
    g(0, "SEQEND");
    g(8, layer);
  };
  const text = (layer: string, at: Point, height: number, value: string) => {
    g(0, "TEXT");
    g(8, layer);
    g(10, fmt(at.x));
    g(20, fmt(at.y));
    g(30, 0);
    g(40, height);
    // Plain ASCII keeps R12 readers happy.
    g(1, value.replace(/²/g, "2").replace(/[^\x20-\x7E]/g, "?"));
  };

  for (const w of plan.walls) line("WALLS", w.a, w.b);
  for (const o of plan.openings) {
    const wall = plan.walls.find((w) => w.id === o.wallId);
    if (!wall) continue;
    line(o.kind === "door" ? "DOORS" : "WINDOWS", pointAlong(wall, o.at - o.width / 2), pointAlong(wall, o.at + o.width / 2));
  }
  for (const c of plan.columns) {
    const hw = c.width / 2;
    const hd = c.depth / 2;
    polyline("COLUMNS", [
      { x: c.at.x - hw, y: c.at.y - hd },
      { x: c.at.x + hw, y: c.at.y - hd },
      { x: c.at.x + hw, y: c.at.y + hd },
      { x: c.at.x - hw, y: c.at.y + hd },
    ]);
  }
  for (const r of plan.rooms) {
    polyline("ROOMS", r.points);
    const c = centroid(r.points);
    text("ROOM-NAMES", c, 250, r.name);
    text("ROOM-NAMES", { x: c.x, y: c.y - 400 }, 180, m2(roomArea(r)));
  }
  for (const l of plan.reference) line("REFERENCE", l.a, l.b);
  if (plan.rooms.length) {
    const xs = plan.walls.flatMap((w) => [w.a.x, w.b.x]);
    const ys = plan.walls.flatMap((w) => [w.a.y, w.b.y]);
    if (xs.length) text("ROOM-NAMES", { x: Math.min(...xs), y: Math.min(...ys) - 800 }, 250, `Usable area ${m2(usableArea(plan))}`);
  }
  g(0, "ENDSEC");
  g(0, "EOF");

  const lines: string[] = [];
  for (let i = 0; i < out.length; i += 2) lines.push(String(out[i]).padStart(3, " "), String(out[i + 1]));
  return lines.join("\r\n") + "\r\n";
}
