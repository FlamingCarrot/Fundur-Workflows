import { ceilingHeight } from "./ceilings";
import { wallFinishPanels } from "./finishes";
import {
  DEFAULTS,
  planBounds,
  wallLength,
  pointAlong,
  type Opening,
  type Plan,
  type PlanItem,
  type Point,
  type Wall,
} from "./geometry";
import { doorLeaves, sortedLevels } from "./elements";
import { STANDARD, blueprintFor, instanceShapes, type Primitive, type Resolver } from "@/lib/blueprints/resolve";
import { itemHeight } from "@/lib/blueprints/symbol";

/** Render descriptors in metres, centred near the drawing to preserve GPU precision.
 * The renderer never writes to the plan. Cut walls and separated floors are views. */
export type Vec3 = [number, number, number];
export type SceneLayer =
  "walls" | "openings" | "columns" | "rooms" | "furniture";
export interface Solid {
  shape: "box" | "cylinder" | "floor" | "sphere" | "wedge" | "lathe" | "extrude";
  at: Vec3;
  size: Vec3;
  rotation: number;
  color: string;
  glass?: boolean;
  points?: [number, number][];
  target: PlanItem;
  levelId: string;
  /** A material from the design library; `color` is its colour or the fallback. */
  material?: string;
  /** Rounded corners for a box, in metres. */
  radius?: number;
  /** A blueprint part's form: its taper, its lathe profile or extruded outline, its hollow wall (metres) and lean (radians). */
  taper?: number;
  profile?: [number, number][];
  hollow?: number;
  tiltX?: number;
  tiltY?: number;
  /** The blueprint parts it comes from, outermost first. */
  path?: string[];
}
export interface SceneOptions {
  levelId: string;
  allLevels: boolean;
  separated: boolean;
  cutWalls: boolean;
  /** Each room's ceiling at its height. */
  ceilings?: boolean;
  layers: Record<SceneLayer, boolean>;
}
export interface WallPiece {
  from: number;
  to: number;
  bottom: number;
  top: number;
}

/** Split a wall around the union of opening voids, including sill and head.
 * Sweeping horizontal intervals handles touching or overlapping openings without
 * duplicate wall solids. The display height may be lower than the saved height. */
export function wallPieces(
  wall: Wall,
  openings: Opening[],
  height: number,
): WallPiece[] {
  const length = wallLength(wall);
  if (length <= 0 || height <= 0) return [];
  const holes = openings
    .filter((o) => o.wallId === wall.id)
    .map((o) => {
      const bottom = o.kind === "window" ? (o.sill ?? DEFAULTS.windowSill) : 0;
      return {
        from: Math.max(0, o.at - o.width / 2),
        to: Math.min(length, o.at + o.width / 2),
        bottom: Math.max(0, bottom),
        top: Math.min(
          height,
          bottom +
            (o.height ??
              (o.kind === "window"
                ? DEFAULTS.windowHeight
                : DEFAULTS.doorHeight)),
        ),
      };
    })
    .filter((h) => h.to > h.from && h.top > h.bottom);
  const edges = [
    ...new Set([0, length, ...holes.flatMap((h) => [h.from, h.to])]),
  ].sort((a, b) => a - b);
  const pieces: WallPiece[] = [];
  for (let i = 0; i < edges.length - 1; i++) {
    const from = edges[i],
      to = edges[i + 1];
    const cuts = holes
      .filter((h) => h.from < to && h.to > from)
      .sort((a, b) => a.bottom - b.bottom);
    let bottom = 0;
    for (const cut of cuts) {
      if (cut.bottom > bottom)
        pieces.push({ from, to, bottom, top: cut.bottom });
      bottom = Math.max(bottom, cut.top);
    }
    if (bottom < height) pieces.push({ from, to, bottom, top: height });
  }
  return pieces;
}

/** Per blueprint object, so an unsaved draft (same id and revision, new object) is never served its old shapes. */
const primitiveCache = new WeakMap<object, Map<string, Primitive[]>>();

/** An item's blueprint shapes at its size, in its own frame (mm); kept for the sizes seen. */
export function itemPrimitives(lib: Resolver, item: PlanItemInstance): Primitive[] {
  const bp = blueprintFor(lib, item);
  const h = itemHeight(lib, item);
  const key = `${lib === STANDARD ? "std" : ""}${item.width}x${item.depth}x${h}:${item.material ?? ""}:${libStamp(lib)}`;
  let sizes = primitiveCache.get(bp);
  if (!sizes) primitiveCache.set(bp, (sizes = new Map()));
  const hit = sizes.get(key);
  if (hit) return hit;
  const shapes = instanceShapes(lib, bp, { w: item.width, d: item.depth, h }, item.material);
  if (sizes.size > 200) sizes.clear();
  sizes.set(key, shapes);
  return shapes;
}

type PlanItemInstance = Pick<Plan["items"][number], "type" | "blueprintId" | "width" | "depth" | "height" | "material">;

/** Changes whenever any blueprint in the library does, so nested changes are never served stale. */
const stamps = new WeakMap<Resolver, string>();
function libStamp(lib: Resolver): string {
  let stamp = stamps.get(lib);
  if (!stamp) {
    stamp = String(lib.blueprints.reduce((n, b) => (n * 31 + b.revision + (b.updatedAt ? b.updatedAt.length : 0)) % 1_000_000_007, lib.blueprints.length));
    stamps.set(lib, stamp);
  }
  return stamp;
}

export function buildScene(
  plan: Plan,
  options: SceneOptions,
  lib: Resolver = STANDARD,
): { solids: Solid[]; origin: Point } {
  // Tracing images and annotations are 2D-only and must not shift the 3D origin.
  const bounds = planBounds({
    ...plan,
    reference: [],
    notes: [],
    dimensions: [],
    underlays: [],
  });
  const origin = bounds
    ? { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 }
    : { x: 0, y: 0 };
  const solids: Solid[] = [];
  const byWall = new Map<string, Opening[]>();
  for (const opening of plan.openings) {
    const entries = byWall.get(opening.wallId) ?? [];
    entries.push(opening);
    byWall.set(opening.wallId, entries);
  }
  const levels = sortedLevels(plan);
  const offset = new Map(
    levels.map((l, i) => [
      l.id,
      l.elevation + (options.allLevels && options.separated ? i * 3_000 : 0),
    ]),
  );
  const shown = (id: string) =>
    offset.has(id) && (options.allLevels || id === options.levelId);
  const at = (p: Point, elevation: number): Vec3 => [
    (p.x - origin.x) / 1_000,
    elevation / 1_000,
    -(p.y - origin.y) / 1_000,
  ];
  const box = (
    target: PlanItem,
    levelId: string,
    p: Point,
    bottom: number,
    width: number,
    height: number,
    depth: number,
    rotation: number,
    color: string,
    glass = false,
    shape: Solid["shape"] = "box",
  ) => {
    if (Math.min(width, height, depth) <= 0) return;
    solids.push({
      shape,
      target,
      levelId,
      at: at(p, bottom + height / 2),
      size: [width / 1_000, height / 1_000, depth / 1_000],
      rotation,
      color,
      glass,
    });
  };

  for (const level of levels.filter((l) => shown(l.id))) {
    const elevation = offset.get(level.id)!;
    if (options.layers.rooms)
      for (const room of plan.rooms.filter(
        (r) => r.levelId === level.id && r.points.length >= 3,
      )) {
        solids.push({
          shape: "floor",
          target: { kind: "room", id: room.id },
          levelId: level.id,
          at: [0, elevation / 1_000 - 0.06, 0],
          size: [1, 0.06, 1],
          rotation: 0,
          points: room.points.map((p) => [
            (p.x - origin.x) / 1_000,
            (p.y - origin.y) / 1_000,
          ]),
          color: (room.floorMaterial && lib.material(room.floorMaterial)?.color) || (room.usable ? "#d2c5b1" : "#bbc3c0"),
          ...(room.floorMaterial && lib.material(room.floorMaterial) ? { material: room.floorMaterial } : {}),
        });
        // The wall finish, a thin skin on each face of the walls round it.
        const finish = room.wallMaterial ? lib.material(room.wallMaterial) : undefined;
        if (finish && options.layers.walls)
          for (const f of wallFinishPanels(plan, room)) {
            const top = options.cutWalls ? Math.min(f.top, 1_100) : f.top;
            if (top <= f.bottom) continue;
            const length = Math.hypot(f.b.x - f.a.x, f.b.y - f.a.y);
            solids.push({
              shape: "box",
              target: { kind: "room", id: room.id },
              levelId: level.id,
              at: at({ x: (f.a.x + f.b.x) / 2, y: (f.a.y + f.b.y) / 2 }, elevation + (f.bottom + top) / 2),
              size: [length / 1_000, (top - f.bottom) / 1_000, 0.004],
              rotation: Math.atan2(f.b.y - f.a.y, f.b.x - f.a.x),
              color: finish.color,
              material: finish.id,
            });
          }
        // The ceiling, a thin sheet at its height; open ceilings show the structure above instead.
        if (options.ceilings && room.ceiling !== "open")
          solids.push({
            shape: "floor",
            target: { kind: "room", id: room.id },
            levelId: level.id,
            at: [0, (elevation + ceilingHeight(plan, room)) / 1_000, 0],
            size: [1, 0.02, 1],
            rotation: 0,
            points: room.points.map((p) => [(p.x - origin.x) / 1_000, (p.y - origin.y) / 1_000]),
            color: room.ceiling === "slats" ? "#b08a5a" : room.ceiling?.startsWith("grid") ? "#e9e7e1" : "#f5f3ef",
          });
      }
    for (const wall of plan.walls.filter((w) => w.levelId === level.id)) {
      const height = options.cutWalls
        ? Math.min(wall.height ?? level.height, 1_100)
        : (wall.height ?? level.height);
      const angle = Math.atan2(wall.b.y - wall.a.y, wall.b.x - wall.a.x);
      const wallOpenings = byWall.get(wall.id) ?? [];
      // A wall with a type is built from its layers, scaled to the wall's own thickness.
      const type = wall.typeId ? lib.blueprint(wall.typeId) : undefined;
      const layers = type?.layers?.length ? type.layers : null;
      const total = layers ? layers.reduce((sum, l) => sum + l.thickness, 0) : 0;
      const normal = { x: -Math.sin(angle), y: Math.cos(angle) };
      if (options.layers.walls)
        for (const piece of wallPieces(wall, wallOpenings, height)) {
          const middle = pointAlong(wall, (piece.from + piece.to) / 2);
          if (!layers) {
            box(
              { kind: "wall", id: wall.id },
              level.id,
              middle,
              elevation + piece.bottom,
              piece.to - piece.from,
              piece.top - piece.bottom,
              wall.thickness,
              angle,
              wall.kind === "partition" ? "#bcc7c1" : "#e5e0d7",
            );
            continue;
          }
          let offset = wall.thickness / 2;
          for (const layer of layers) {
            const t = (layer.thickness / total) * wall.thickness;
            const material = lib.material(layer.material);
            const before = solids.length;
            box(
              { kind: "wall", id: wall.id },
              level.id,
              { x: middle.x + normal.x * (offset - t / 2), y: middle.y + normal.y * (offset - t / 2) },
              elevation + piece.bottom,
              piece.to - piece.from,
              piece.top - piece.bottom,
              t,
              angle,
              material?.color ?? "#e5e0d7",
              (material?.opacity ?? 1) < 0.95,
            );
            if (solids[before]) solids[before].material = layer.material;
            offset -= t;
          }
        }
      if (options.layers.openings)
        for (const opening of wallOpenings) {
          const target: PlanItem = { kind: "opening", id: opening.id };
          const sill =
            opening.kind === "window"
              ? (opening.sill ?? DEFAULTS.windowSill)
              : 0;
          const head = Math.min(
            height,
            sill +
              (opening.height ??
                (opening.kind === "window"
                  ? DEFAULTS.windowHeight
                  : DEFAULTS.doorHeight)),
          );
          const visibleHeight = head - sill;
          if (visibleHeight <= 0) continue;
          const p = pointAlong(wall, opening.at);
          if (opening.kind === "window") {
            box(
              target,
              level.id,
              p,
              elevation + sill,
              opening.width,
              visibleHeight,
              20,
              angle,
              "#8fbbc2",
              true,
            );
            for (const d of [-opening.width / 2 + 20, opening.width / 2 - 20])
              box(
                target,
                level.id,
                pointAlong(wall, opening.at + d),
                elevation + sill,
                40,
                visibleHeight,
                45,
                angle,
                "#687875",
              );
            for (const y of [sill, head - 40])
              box(
                target,
                level.id,
                p,
                elevation + y,
                opening.width,
                40,
                45,
                angle,
                "#687875",
              );
          } else {
            for (const leaf of doorLeaves(wall, opening)) {
              const centre = {
                x: (leaf.hinge.x + leaf.open.x) / 2,
                y: (leaf.hinge.y + leaf.open.y) / 2,
              };
              const leafAngle = Math.atan2(
                leaf.open.y - leaf.hinge.y,
                leaf.open.x - leaf.hinge.x,
              );
              box(
                target,
                level.id,
                centre,
                elevation,
                Math.hypot(
                  leaf.open.x - leaf.hinge.x,
                  leaf.open.y - leaf.hinge.y,
                ),
                visibleHeight,
                35,
                leafAngle,
                "#b89974",
              );
            }
            if (opening.style === "sliding")
              box(
                target,
                level.id,
                p,
                elevation,
                opening.width,
                visibleHeight,
                35,
                angle,
                "#b89974",
              );
          }
        }
    }
    if (options.layers.columns)
      for (const column of plan.columns.filter((c) => c.levelId === level.id)) {
        box(
          { kind: "column", id: column.id },
          level.id,
          column.at,
          elevation,
          column.width,
          options.cutWalls ? Math.min(level.height, 1_100) : level.height,
          column.round ? column.width : column.depth,
          0,
          "#a9aaa3",
          false,
          column.round ? "cylinder" : "box",
        );
      }
    if (options.layers.furniture)
      for (const item of plan.items.filter((i) => i.levelId === level.id && !i.hidden)) {
        const angle = (item.rotation * Math.PI) / 180;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        const target: PlanItem = { kind: "item", id: item.id };
        const lift = item.elevation ?? 0;
        for (const part of itemPrimitives(lib, item)) {
          const p = { x: item.at.x + part.x * cos - part.y * sin, y: item.at.y + part.x * sin + part.y * cos };
          const material = part.material ? lib.material(part.material) : undefined;
          const before = solids.length;
          box(
            target,
            level.id,
            p,
            elevation + lift + part.z,
            part.w,
            part.h,
            part.d,
            angle + part.rotation,
            item.color ?? material?.color ?? "#c2c9c4",
            (material?.opacity ?? 1) < 0.95,
            part.shape === "box" ? "box" : part.shape,
          );
          const made = solids[before];
          if (made) {
            if (part.material) made.material = part.material;
            if (part.radius) made.radius = part.radius / 1_000;
            if (part.taper != null) made.taper = part.taper;
            if (part.profile) made.profile = part.profile;
            if (part.hollow) made.hollow = part.hollow / 1_000;
            if (part.tiltX) made.tiltX = part.tiltX;
            if (part.tiltY) made.tiltY = part.tiltY;
            made.path = part.path;
          }
        }
      }
  }
  return { solids, origin };
}
