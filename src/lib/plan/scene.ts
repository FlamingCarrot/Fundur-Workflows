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
import { libraryItem } from "./library";

/** Render descriptors in metres, centred near the drawing to preserve GPU precision.
 * The renderer never writes to the plan. Cut walls and separated floors are views. */
export type Vec3 = [number, number, number];
export type SceneLayer =
  "walls" | "openings" | "columns" | "rooms" | "furniture";
export interface Solid {
  shape: "box" | "cylinder" | "floor";
  at: Vec3;
  size: Vec3;
  rotation: number;
  color: string;
  glass?: boolean;
  points?: [number, number][];
  target: PlanItem;
  levelId: string;
}
export interface SceneOptions {
  levelId: string;
  allLevels: boolean;
  separated: boolean;
  cutWalls: boolean;
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

export function buildScene(
  plan: Plan,
  options: SceneOptions,
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
          color: room.usable ? "#d2c5b1" : "#bbc3c0",
        });
      }
    for (const wall of plan.walls.filter((w) => w.levelId === level.id)) {
      const height = options.cutWalls
        ? Math.min(wall.height ?? level.height, 1_100)
        : (wall.height ?? level.height);
      const angle = Math.atan2(wall.b.y - wall.a.y, wall.b.x - wall.a.x);
      const wallOpenings = byWall.get(wall.id) ?? [];
      if (options.layers.walls)
        for (const piece of wallPieces(wall, wallOpenings, height)) {
          box(
            { kind: "wall", id: wall.id },
            level.id,
            pointAlong(wall, (piece.from + piece.to) / 2),
            elevation + piece.bottom,
            piece.to - piece.from,
            piece.top - piece.bottom,
            wall.thickness,
            angle,
            wall.kind === "partition" ? "#bcc7c1" : "#e5e0d7",
          );
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
        const library = libraryItem(item.type);
        const w = item.width,
          d = item.depth,
          h = library.height;
        const angle = (item.rotation * Math.PI) / 180;
        const target: PlanItem = { kind: "item", id: item.id };
        const part = (
          x: number,
          y: number,
          bottom: number,
          width: number,
          height: number,
          depth: number,
          color: string,
          shape: Solid["shape"] = "box",
        ) => {
          const p = {
            x: item.at.x + x * Math.cos(angle) - y * Math.sin(angle),
            y: item.at.y + x * Math.sin(angle) + y * Math.cos(angle),
          };
          box(
            target,
            level.id,
            p,
            elevation + bottom,
            width,
            height,
            depth,
            angle,
            item.color ?? color,
            false,
            shape,
          );
        };
        const seat = /chair|sofa|armchair|bench|stool|ottoman/.test(item.type);
        const table = /desk|table/.test(item.type);
        if (seat) {
          const sh = Math.min(450, h * 0.55);
          part(0, 0, 0, w * 0.84, sh * 0.7, d * 0.82, "#706a62");
          part(0, 0, sh * 0.7, w, sh * 0.3, d, "#a1ad9c");
          if (!/stool|ottoman|bench/.test(item.type))
            part(0, d * 0.42, sh, w, h - sh, d * 0.16, "#a1ad9c");
          if (/sofa|armchair/.test(item.type))
            for (const x of [-w * 0.44, w * 0.44])
              part(x, 0, sh, w * 0.12, h * 0.2, d, "#a1ad9c");
        } else if (table) {
          part(
            0,
            0,
            Math.max(0, h - 55),
            w,
            Math.min(h, 55),
            d,
            "#b89974",
            /round/.test(item.type) ? "cylinder" : "box",
          );
          const leg = Math.min(65, w * 0.12, d * 0.12);
          for (const x of [-w * 0.4, w * 0.4])
            for (const y of [-d * 0.35, d * 0.35])
              part(x, y, 0, leg, h - 55, leg, "#626a69");
        } else
          part(
            0,
            0,
            0,
            w,
            h,
            d,
            library.category === "Storage" ? "#b89974" : "#c2c9c4",
          );
      }
  }
  return { solids, origin };
}
