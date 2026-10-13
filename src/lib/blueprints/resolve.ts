import type { Shape } from "@/lib/plan/library";
import { STANDARD_BLUEPRINTS } from "./defaults";
import { STANDARD_MATERIALS } from "./materials";
import { latheReach } from "./forms";
import type { Blueprint, Library, Material, Part, PartShape, ProfilePoint, Size3 } from "./types";

/**
 * Reading blueprints: finding one by id across the defaults and the practice's
 * library, flattening nested blueprints into the simple shapes that are drawn,
 * the plan symbol, and which blueprints use which.
 */

/** How deep blueprints may nest; deeper parts are left out. */
export const MAX_DEPTH = 8;
/** How many shapes one blueprint may flatten to, so a runaway nesting cannot stall the screen. */
export const MAX_PRIMITIVES = 4_000;

export interface Resolver {
  blueprint(id: string): Blueprint | undefined;
  material(id: string): Material | undefined;
  blueprints: Blueprint[];
  materials: Material[];
}

/** The defaults with the practice's own entries over them. */
export function resolver(library: Partial<Library> = {}): Resolver {
  const blueprints = [...STANDARD_BLUEPRINTS, ...(library.blueprints ?? [])];
  const materials = [...STANDARD_MATERIALS, ...(library.materials ?? [])];
  const b = new Map(blueprints.map((x) => [x.id, x]));
  const m = new Map(materials.map((x) => [x.id, x]));
  return { blueprint: (id) => b.get(id), material: (id) => m.get(id), blueprints, materials };
}

export const STANDARD = resolver();

/** A simple shape in some frame: footprint middle (x, y), underside z, size, turn in radians. */
export interface Primitive {
  shape: PartShape;
  x: number;
  y: number;
  z: number;
  w: number;
  d: number;
  h: number;
  rotation: number;
  radius?: number;
  material?: string;
  /** As on the part: a taper, a lathe's profile or an extrusion's outline, a hollow wall (mm). */
  taper?: number;
  profile?: ProfilePoint[];
  hollow?: number;
  /** Lean about the part's own x and y (radians). */
  tiltX?: number;
  tiltY?: number;
  /** The ids of the parts it comes from, outermost first. */
  path: string[];
}

interface Frame {
  x: number;
  y: number;
  z: number;
  /** Radians. */
  rotation: number;
  sx: number;
  sy: number;
  sz: number;
  material?: string;
}

const IDENTITY: Frame = { x: 0, y: 0, z: 0, rotation: 0, sx: 1, sy: 1, sz: 1 };

/**
 * Places a part's frame inside its parent's. Parents only turn about the
 * vertical, so a turned child under an uneven stretch is approximated by
 * stretching it along its own axes (exact for quarter turns).
 */
function place(parent: Frame, at: { x: number; y: number; z: number }, rotationDeg: number) {
  const lx = at.x * parent.sx;
  const ly = at.y * parent.sy;
  const c = Math.cos(parent.rotation);
  const s = Math.sin(parent.rotation);
  const r = (rotationDeg * Math.PI) / 180;
  const cr = Math.cos(r);
  const sr = Math.sin(r);
  return {
    x: parent.x + lx * c - ly * s,
    y: parent.y + lx * s + ly * c,
    z: parent.z + at.z * parent.sz,
    rotation: parent.rotation + r,
    // The parent's stretch seen along the child's own axes.
    kx: Math.hypot(parent.sx * cr, parent.sy * sr),
    ky: Math.hypot(parent.sx * sr, parent.sy * cr),
  };
}

/**
 * Every simple shape a blueprint is made of, in the frame given, with nested
 * blueprints expanded. A blueprint that contains itself, however deep, is
 * drawn once and its loop left out.
 */
export function flatten(lib: Resolver, blueprint: Blueprint, frame: Frame = IDENTITY, out: Primitive[] = [], trail: string[] = [], path: string[] = []): Primitive[] {
  if (trail.length >= MAX_DEPTH || trail.includes(blueprint.id)) return out;
  const chain = [...trail, blueprint.id];
  for (const part of blueprint.parts) {
    if (out.length >= MAX_PRIMITIVES) break;
    const placed = place(frame, part.at, part.rotation);
    const w = part.size.w * placed.kx;
    const d = part.size.d * placed.ky;
    const h = part.size.h * frame.sz;
    const material = frame.material ?? part.material;
    if (part.blueprintId) {
      const child = lib.blueprint(part.blueprintId);
      if (!child || child.size.w <= 0 || child.size.d <= 0 || child.size.h <= 0) {
        out.push({ shape: "box", x: placed.x, y: placed.y, z: placed.z, w, d, h, rotation: placed.rotation, material, path: [...path, part.id] });
        continue;
      }
      // The child's own origin is the middle of its footprint, so its parts land around the part's middle.
      flatten(
        lib,
        child,
        { x: placed.x, y: placed.y, z: placed.z, rotation: placed.rotation, sx: w / child.size.w, sy: d / child.size.d, sz: h / child.size.h, material: frame.material ?? part.material },
        out,
        chain,
        [...path, part.id],
      );
    } else {
      out.push({
        shape: part.shape ?? "box",
        x: placed.x,
        y: placed.y,
        z: placed.z,
        w,
        d,
        h,
        rotation: placed.rotation,
        ...(part.radius ? { radius: part.radius * Math.min(placed.kx, placed.ky) } : {}),
        ...(part.taper != null && part.taper !== 1 ? { taper: part.taper } : {}),
        ...(part.profile && (part.shape === "lathe" || part.shape === "extrude") ? { profile: part.profile } : {}),
        ...(part.hollow ? { hollow: part.hollow * Math.min(placed.kx, placed.ky, frame.sz) } : {}),
        ...(part.tilt?.x ? { tiltX: (part.tilt.x * Math.PI) / 180 } : {}),
        ...(part.tilt?.y ? { tiltY: (part.tilt.y * Math.PI) / 180 } : {}),
        material,
        path: [...path, part.id],
      });
    }
  }
  return out;
}

/** A blueprint's shapes stretched to an instance's size, in the instance's own frame (mm). */
export function instanceShapes(lib: Resolver, blueprint: Blueprint, size: Size3, material?: string): Primitive[] {
  const { w, d, h } = blueprint.size;
  return flatten(lib, blueprint, { ...IDENTITY, sx: size.w / (w || 1), sy: size.d / (d || 1), sz: size.h / (h || 1), material });
}

/** The extent of a set of shapes, for framing previews. */
export function extent(shapes: Primitive[]): { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number } | null {
  if (!shapes.length) return null;
  const e = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, minZ: Infinity, maxZ: -Infinity };
  for (const s of shapes) {
    const c = Math.abs(Math.cos(s.rotation));
    const n = Math.abs(Math.sin(s.rotation));
    const k = spread(s);
    const hx = ((s.w * c + s.d * n) / 2) * k;
    const hy = ((s.w * n + s.d * c) / 2) * k;
    e.minX = Math.min(e.minX, s.x - hx);
    e.maxX = Math.max(e.maxX, s.x + hx);
    e.minY = Math.min(e.minY, s.y - hy);
    e.maxY = Math.max(e.maxY, s.y + hy);
    e.minZ = Math.min(e.minZ, s.z);
    e.maxZ = Math.max(e.maxZ, s.z + s.h);
  }
  return e;
}

/** The corners of a shape's footprint, anticlockwise. */
export function footprint(s: Pick<Primitive, "x" | "y" | "w" | "d" | "rotation">): { x: number; y: number }[] {
  const c = Math.cos(s.rotation);
  const n = Math.sin(s.rotation);
  return [
    [-s.w / 2, -s.d / 2],
    [s.w / 2, -s.d / 2],
    [s.w / 2, s.d / 2],
    [-s.w / 2, s.d / 2],
  ].map(([x, y]) => ({ x: s.x + x * c - y * n, y: s.y + x * n + y * c }));
}

/** An extrusion's outline on the plan, in the frame its shape is given in. */
export function extrudedOutline(s: Pick<Primitive, "x" | "y" | "w" | "d" | "rotation" | "profile" | "taper">): { x: number; y: number }[] {
  const c = Math.cos(s.rotation);
  const n = Math.sin(s.rotation);
  const grow = Math.max(1, s.taper ?? 1);
  return (s.profile ?? []).map(([u, v]) => {
    const x = (u - 0.5) * s.w * grow;
    const y = (v - 0.5) * s.d * grow;
    return { x: s.x + x * c - y * n, y: s.y + x * n + y * c };
  });
}

/** How much wider than its footprint a shape gets above it (a taper over 1, a lathe's reach). */
export function spread(s: Pick<Primitive, "shape" | "taper" | "profile">): number {
  if (s.shape === "lathe") return s.profile?.length ? latheReach(s.profile) : 1;
  return Math.max(1, s.taper ?? 1);
}

/** Outlines of the shapes seen from above, for the 2D plan, lowest first so tops draw over. */
export function topView(shapes: Primitive[]): Shape[] {
  const out: Shape[] = [];
  for (const s of [...shapes].sort((a, b) => a.z + a.h - (b.z + b.h))) {
    if (s.w < 1 || s.d < 1) continue;
    if (s.shape === "cylinder" || s.shape === "sphere" || s.shape === "lathe") {
      const k = spread(s);
      if (Math.abs(s.w - s.d) < 1) out.push({ t: "circle", x: s.x, y: s.y, r: (s.w / 2) * k });
      else out.push({ t: "ellipse", x: s.x, y: s.y, rx: (s.w / 2) * k, ry: (s.d / 2) * k, rotation: s.rotation });
    } else if (s.shape === "extrude" && (s.profile?.length ?? 0) >= 3) {
      out.push({ t: "poly", points: extrudedOutline(s) });
    } else if ((s.taper ?? 1) > 1) {
      out.push({ t: "poly", points: footprint({ ...s, w: s.w * s.taper!, d: s.d * s.taper! }) });
    } else if (Math.abs(Math.sin(s.rotation)) < 1e-6 && !s.radius) {
      out.push({ t: "rect", x: s.x - s.w / 2, y: s.y - s.d / 2, w: s.w, h: s.d });
    } else if (Math.abs(Math.sin(s.rotation)) < 1e-6) {
      out.push({ t: "rect", x: s.x - s.w / 2, y: s.y - s.d / 2, w: s.w, h: s.d, r: Math.min(s.radius ?? 0, s.w / 2, s.d / 2) });
    } else out.push({ t: "poly", points: footprint(s) });
  }
  return out;
}

/** Ids of blueprints that use `id`, directly or through others. */
export function usedBy(lib: Resolver, id: string): Blueprint[] {
  const users = new Set<string>();
  let frontier = [id];
  while (frontier.length) {
    const next: string[] = [];
    for (const b of lib.blueprints)
      if (!users.has(b.id) && b.parts.some((p) => p.blueprintId && frontier.includes(p.blueprintId))) {
        users.add(b.id);
        next.push(b.id);
      }
    frontier = next;
  }
  users.delete(id);
  return lib.blueprints.filter((b) => users.has(b.id));
}

/** Whether nesting `childId` inside `parentId` would make a blueprint contain itself. */
export function wouldLoop(lib: Resolver, parentId: string, childId: string): boolean {
  if (parentId === childId) return true;
  const seen = new Set<string>();
  const stack = [childId];
  while (stack.length) {
    const id = stack.pop()!;
    if (id === parentId) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const p of lib.blueprint(id)?.parts ?? []) if (p.blueprintId) stack.push(p.blueprintId);
  }
  return false;
}

/** The default blueprint of a furniture type, which items of that type show without naming it. */
export function isStandardType(bp: Blueprint): boolean {
  return bp.id === `std:${bp.type}`;
}

/** The blueprint an item on the plan shows: its own, or the default for its furniture type. */
export function blueprintFor(lib: Resolver, item: { type: string; blueprintId?: string }): Blueprint {
  return (item.blueprintId && lib.blueprint(item.blueprintId)) || lib.blueprint(`std:${item.type}`) || lib.blueprint("std:box")!;
}

/** Counts of each material across a blueprint, for its schedule. */
export function materialsUsed(lib: Resolver, blueprint: Blueprint): { id: string; name: string; parts: number }[] {
  const counts = new Map<string, number>();
  for (const s of flatten(lib, blueprint)) if (s.material) counts.set(s.material, (counts.get(s.material) ?? 0) + 1);
  return [...counts].map(([id, parts]) => ({ id, name: lib.material(id)?.name ?? "Missing material", parts })).sort((a, b) => b.parts - a.parts);
}

export type { Part };
