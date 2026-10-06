import { wallHeight } from "./elements";
import { DEFAULTS, roomArea, wallLength, type Opening, type Plan, type Point, type Wall } from "./geometry";
import { libraryItem } from "./library";

/**
 * IFC4 export (P3-07). IFC is the open format Revit, ArchiCAD and most BIM
 * tools read: each floor becomes a storey, walls and partitions are walls
 * with real openings cut for their doors and windows, rooms are spaces with
 * their areas, and columns, furniture and sanitary fittings are their own
 * elements. Everything is in millimetres, extruded to its height, so the file
 * opens as a 3D model.
 *
 * Every element's GlobalId is derived from its id on the plan, so exporting
 * the same plan twice gives the same ids and a tool comparing the two sees
 * what changed rather than a whole new building.
 */

const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$";

/** 128 stable bits from a string (cyrb128). */
function hash128(text: string): bigint {
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;
  for (let i = 0; i < text.length; i++) {
    const k = text.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  h1 ^= h2 ^ h3 ^ h4;
  h2 ^= h1;
  h3 ^= h1;
  h4 ^= h1;
  return [h1, h2, h3, h4].reduce((n, h) => (n << BigInt(32)) | BigInt(h >>> 0), BigInt(0));
}

/** IFC's 22-character GlobalId for a key. */
export function globalId(key: string): string {
  let n = hash128(key);
  let out = "";
  for (let i = 0; i < 22; i++) {
    out = ALPHABET[Number(n & BigInt(63))] + out;
    n >>= BigInt(6);
  }
  return out;
}

/** A STEP string: quotes doubled, backslashes doubled, anything beyond ASCII encoded. */
function str(text: string): string {
  let out = "";
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    if (ch === "'") out += "''";
    else if (ch === "\\") out += "\\\\";
    else if (code >= 32 && code < 127) out += ch;
    else if (code <= 0xffff) out += `\\X2\\${code.toString(16).toUpperCase().padStart(4, "0")}\\X0\\`;
    else out += `\\X4\\${code.toString(16).toUpperCase().padStart(8, "0")}\\X0\\`;
  }
  return `'${out}'`;
}

/** A STEP real: always with a decimal point. */
function real(value: number): string {
  const v = Math.round(value * 1_000) / 1_000;
  const s = String(Object.is(v, -0) ? 0 : v);
  return s.includes(".") || s.includes("e") ? s : `${s}.`;
}

type Ref = `#${number}`;

class Writer {
  private lines: string[] = [];
  add(entity: string): Ref {
    this.lines.push(entity);
    return `#${this.lines.length}`;
  }
  body(): string {
    return this.lines.map((l, i) => `#${i + 1}=${l};`).join("\n");
  }
}

const SANITARY: Record<string, string> = {
  wc: "TOILETPAN",
  basin: "WASHHANDBASIN",
  shower: "SHOWER",
  bath: "BATH",
  urinal: "URINAL",
  "kitchen-sink": "SINK",
};

const DOOR_OPERATION: Record<string, string> = {
  double: "DOUBLE_DOOR_SINGLE_SWING",
  sliding: "SLIDING_TO_LEFT",
  opening: "NOTDEFINED",
};

export interface IfcOptions {
  projectName: string;
  /** Shown as the file's description, e.g. the version it came from. */
  description?: string;
  /** For a fixed timestamp in tests. */
  now?: Date;
}

export function exportIfc(plan: Plan, options: IfcOptions): string {
  const w = new Writer();
  const ref = (refs: Ref[]) => `(${refs.join(",")})`;
  const point3 = (x: number, y: number, z: number) => w.add(`IFCCARTESIANPOINT((${real(x)},${real(y)},${real(z)}))`);
  const point2 = (p: Point) => w.add(`IFCCARTESIANPOINT((${real(p.x)},${real(p.y)}))`);
  const dir3 = (x: number, y: number, z: number) => w.add(`IFCDIRECTION((${real(x)},${real(y)},${real(z)}))`);
  const zUp = dir3(0, 0, 1);
  const origin = point3(0, 0, 0);
  const xAxis = dir3(1, 0, 0);
  const axis3 = (x = 0, y = 0, z = 0, ux = 1, uy = 0) =>
    w.add(`IFCAXIS2PLACEMENT3D(${x || y || z ? point3(x, y, z) : origin},${zUp},${ux === 1 && uy === 0 ? xAxis : dir3(ux, uy, 0)})`);
  const axis2 = (p: Point) => w.add(`IFCAXIS2PLACEMENT2D(${point2(p)},$)`);
  const place = (relativeTo: Ref | null, placement: Ref) => w.add(`IFCLOCALPLACEMENT(${relativeTo ?? "$"},${placement})`);
  const guid = (key: string) => str(globalId(key));

  // Units: millimetres, square metres, radians.
  const units = [
    w.add("IFCSIUNIT(*,.LENGTHUNIT.,.MILLI.,.METRE.)"),
    w.add("IFCSIUNIT(*,.AREAUNIT.,$,.SQUARE_METRE.)"),
    w.add("IFCSIUNIT(*,.VOLUMEUNIT.,$,.CUBIC_METRE.)"),
    w.add("IFCSIUNIT(*,.PLANEANGLEUNIT.,$,.RADIAN.)"),
  ];
  const unitAssignment = w.add(`IFCUNITASSIGNMENT(${ref(units)})`);
  const context = w.add(`IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.E-05,${axis3()},${w.add("IFCDIRECTION((0.,1.))")})`);
  const body = w.add(`IFCGEOMETRICREPRESENTATIONSUBCONTEXT('Body','Model',*,*,*,*,${context},$,.MODEL_VIEW.,$)`);
  const axisContext = w.add(`IFCGEOMETRICREPRESENTATIONSUBCONTEXT('Axis','Model',*,*,*,*,${context},$,.GRAPH_VIEW.,$)`);

  const project = w.add(
    `IFCPROJECT(${guid("project")},$,${str(options.projectName)},${options.description ? str(options.description) : "$"},$,$,$,(${context}),${unitAssignment})`
  );
  const sitePlacement = place(null, axis3());
  const site = w.add(`IFCSITE(${guid("site")},$,'Site',$,$,${sitePlacement},$,$,.ELEMENT.,$,$,$,$,$)`);
  const buildingPlacement = place(sitePlacement, axis3());
  const building = w.add(`IFCBUILDING(${guid("building")},$,${str(options.projectName)},$,$,${buildingPlacement},$,$,.ELEMENT.,$,$,$)`);
  w.add(`IFCRELAGGREGATES(${guid("project-site")},$,$,$,${project},(${site}))`);
  w.add(`IFCRELAGGREGATES(${guid("site-building")},$,$,$,${site},(${building}))`);

  /** An extruded solid as a body shape. */
  const extrusion = (profile: Ref, depth: number, at: Ref = axis3()) =>
    w.add(`IFCEXTRUDEDAREASOLID(${profile},${at},${zUp},${real(depth)})`);
  const shape = (items: Ref[], extra: Ref[] = []) =>
    w.add(`IFCPRODUCTDEFINITIONSHAPE($,$,(${[w.add(`IFCSHAPEREPRESENTATION(${body},'Body','SweptSolid',${ref(items)})`), ...extra].join(",")}))`);
  const rectangle = (centre: Point, x: number, y: number) => w.add(`IFCRECTANGLEPROFILEDEF(.AREA.,$,${axis2(centre)},${real(x)},${real(y)})`);

  const storeys: Ref[] = [];
  const levels = [...plan.levels].sort((p, q) => p.elevation - q.elevation);
  for (const level of levels) {
    const storeyPlacement = place(buildingPlacement, axis3(0, 0, level.elevation));
    const storey = w.add(
      `IFCBUILDINGSTOREY(${guid(`level:${level.id}`)},$,${str(level.name)},$,$,${storeyPlacement},$,$,.ELEMENT.,${real(level.elevation)})`
    );
    storeys.push(storey);
    const contained: Ref[] = [];
    const spaces: Ref[] = [];

    // Walls, with their openings cut and filled.
    const walls = plan.walls.filter((x) => x.levelId === level.id);
    for (const wall of walls) {
      const length = wallLength(wall);
      if (length < 1) continue;
      const height = wallHeight(plan, wall);
      const ux = (wall.b.x - wall.a.x) / length;
      const uy = (wall.b.y - wall.a.y) / length;
      const wallPlacement = place(storeyPlacement, axis3(wall.a.x, wall.a.y, 0, ux, uy));
      const axisRep = w.add(
        `IFCSHAPEREPRESENTATION(${axisContext},'Axis','Curve2D',(${w.add(`IFCPOLYLINE((${point2({ x: 0, y: 0 })},${point2({ x: length, y: 0 })}))`)}))`
      );
      const solid = extrusion(rectangle({ x: length / 2, y: 0 }, length, wall.thickness), height);
      const element = w.add(
        `IFCWALL(${guid(`wall:${wall.id}`)},$,${str(wall.kind === "partition" ? "Partition" : "Wall")},$,$,${wallPlacement},${shape([solid], [axisRep])},$,.${wall.kind === "partition" ? "PARTITIONING" : "STANDARD"}.)`
      );
      contained.push(element);
      for (const opening of plan.openings.filter((o) => o.wallId === wall.id)) {
        contained.push(...openingIn(wall, opening, element, wallPlacement, height));
      }
    }

    function openingIn(wall: Wall, opening: Opening, wallElement: Ref, wallPlacement: Ref, wallTall: number): Ref[] {
      const isDoor = opening.kind === "door";
      const sill = isDoor ? 0 : (opening.sill ?? DEFAULTS.windowSill);
      const tall = Math.min(opening.height ?? (isDoor ? DEFAULTS.doorHeight : DEFAULTS.windowHeight), Math.max(1, wallTall - sill));
      const holePlacement = place(wallPlacement, axis3(opening.at, 0, sill));
      // The hole runs a little proud of both faces so it cuts cleanly.
      const hole = w.add(
        `IFCOPENINGELEMENT(${guid(`opening:${opening.id}`)},$,${str(isDoor ? "Door opening" : "Window opening")},$,$,${holePlacement},${shape([extrusion(rectangle({ x: 0, y: 0 }, opening.width, wall.thickness + 20), tall)])},$,.OPENING.)`
      );
      w.add(`IFCRELVOIDSELEMENT(${guid(`voids:${opening.id}`)},$,$,$,${wallElement},${hole})`);
      if (isDoor && opening.style === "opening") return [];
      const panelDepth = isDoor ? 50 : Math.min(80, wall.thickness);
      const panel = extrusion(rectangle({ x: 0, y: 0 }, opening.width, panelDepth), tall);
      const fillPlacement = place(holePlacement, axis3());
      const fill = isDoor
        ? w.add(
            `IFCDOOR(${guid(`door:${opening.id}`)},$,'Door',$,$,${fillPlacement},${shape([panel])},$,${real(tall)},${real(opening.width)},.DOOR.,.${DOOR_OPERATION[opening.style ?? "single"] ?? ((opening.hinge ?? "start") === "start" ? "SINGLE_SWING_LEFT" : "SINGLE_SWING_RIGHT")}.,$)`
          )
        : w.add(`IFCWINDOW(${guid(`window:${opening.id}`)},$,'Window',$,$,${fillPlacement},${shape([panel])},$,${real(tall)},${real(opening.width)},.WINDOW.,.SINGLE_PANEL.,$)`);
      w.add(`IFCRELFILLSELEMENT(${guid(`fills:${opening.id}`)},$,$,$,${hole},${fill})`);
      return [fill];
    }

    for (const column of plan.columns.filter((c) => c.levelId === level.id)) {
      const profile = column.round
        ? w.add(`IFCCIRCLEPROFILEDEF(.AREA.,$,${axis2({ x: 0, y: 0 })},${real(column.width / 2)})`)
        : rectangle({ x: 0, y: 0 }, column.width, column.depth);
      contained.push(
        w.add(
          `IFCCOLUMN(${guid(`column:${column.id}`)},$,'Column',$,$,${place(storeyPlacement, axis3(column.at.x, column.at.y, 0))},${shape([extrusion(profile, level.height)])},$,.COLUMN.)`
        )
      );
    }

    for (const room of plan.rooms.filter((r) => r.levelId === level.id)) {
      const corners = room.points.map(point2);
      const outline = w.add(`IFCPOLYLINE((${[...corners, corners[0]].join(",")}))`);
      const profile = w.add(`IFCARBITRARYCLOSEDPROFILEDEF(.AREA.,$,${outline})`);
      const space = w.add(
        `IFCSPACE(${guid(`room:${room.id}`)},$,${str(room.name)},$,$,${place(storeyPlacement, axis3())},${shape([extrusion(profile, level.height)])},${str(room.name)},.ELEMENT.,.${room.usable ? "INTERNAL" : "NOTDEFINED"}.,$)`
      );
      spaces.push(space);
      const area = w.add(`IFCQUANTITYAREA('NetFloorArea',$,$,${real(roomArea(room))},$)`);
      const quantities = w.add(`IFCELEMENTQUANTITY(${guid(`qto:${room.id}`)},$,'Qto_SpaceBaseQuantities',$,$,(${area}))`);
      w.add(`IFCRELDEFINESBYPROPERTIES(${guid(`qto-rel:${room.id}`)},$,$,$,(${space}),${quantities})`);
    }

    for (const item of plan.items.filter((i) => i.levelId === level.id)) {
      const kind = libraryItem(item.type);
      const angle = (item.rotation * Math.PI) / 180;
      const placement = place(storeyPlacement, axis3(item.at.x, item.at.y, 0, Math.cos(angle), Math.sin(angle)));
      const solid = shape([extrusion(rectangle({ x: 0, y: 0 }, item.width, item.depth), kind.height)]);
      const name = str(item.label ? `${kind.name} ${item.label}` : kind.name);
      const sanitary = SANITARY[kind.type];
      contained.push(
        sanitary
          ? w.add(`IFCSANITARYTERMINAL(${guid(`item:${item.id}`)},$,${name},$,${str(kind.type)},${placement},${solid},$,.${sanitary}.)`)
          : w.add(`IFCFURNITURE(${guid(`item:${item.id}`)},$,${name},$,${str(kind.type)},${placement},${solid},$,.NOTDEFINED.)`)
      );
    }

    if (spaces.length) w.add(`IFCRELAGGREGATES(${guid(`storey-spaces:${level.id}`)},$,$,$,${storey},${ref(spaces)})`);
    if (contained.length) w.add(`IFCRELCONTAINEDINSPATIALSTRUCTURE(${guid(`storey-elements:${level.id}`)},$,$,$,${ref(contained)},${storey})`);
  }
  w.add(`IFCRELAGGREGATES(${guid("building-storeys")},$,$,$,${building},${ref(storeys)})`);

  const stamp = (options.now ?? new Date()).toISOString().slice(0, 19);
  return [
    "ISO-10303-21;",
    "HEADER;",
    "FILE_DESCRIPTION(('ViewDefinition [ReferenceView]'),'2;1');",
    `FILE_NAME(${str(`${options.projectName}.ifc`)},'${stamp}',(''),('Fundur'),'Fundur Workflows','Fundur Workflows','');`,
    "FILE_SCHEMA(('IFC4'));",
    "ENDSEC;",
    "DATA;",
    w.body(),
    "ENDSEC;",
    "END-ISO-10303-21;",
    "",
  ].join("\n");
}
