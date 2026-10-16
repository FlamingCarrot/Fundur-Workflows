import { wallParts, wallThickness } from "./defaults";
import { extent, flatten, wouldLoop, type Resolver } from "./resolve";
import { cleanProfile, defaultProfile } from "./forms";
import type { Blueprint, BlueprintCategory, Part, PartShape, Size3, Vec3mm, WallLayer } from "./types";
import {
  addVertexOnFace,
  alignPoints,
  deleteFaces,
  deletePoints,
  extrudeFaces,
  flipFaces,
  insetFaces,
  makeFace,
  mergePoints,
  meshPoints,
  movePoints,
  rotatePoints,
  scalePoints,
  setPoint,
  smoothPoints,
  splitEdges,
  subdivideFaces,
  toMesh,
  sculptStroke,
  type SculptStroke,
  triangulateFaces,
  weldPoints,
} from "./mesh";

/**
 * Edits to a blueprint, each a pure function returning the changed blueprint
 * and a line saying what changed, or why it cannot be done. The blueprint
 * editor and the assistant make the same edits.
 */

export type BlueprintEdit = { ok: true; blueprint: Blueprint; summary: string; partId?: string; /** Mesh points to keep selected after a point edit. */ points?: number[] } | { ok: false; error: string };

const fail = (error: string): BlueprintEdit => ({ ok: false, error });
const MAX_SIZE = 100_000;
const newPartId = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10));

const SHAPE_NAMES: Record<PartShape, string> = { box: "Box", cylinder: "Cylinder", sphere: "Sphere", wedge: "Wedge", lathe: "Turned", mesh: "Mesh", extrude: "Extrusion" };

/**
 * A part with its form set from a patch: taper (0 to 4, 1 is straight),
 * profile (cleaned; a lathe needs 2 points, an extrusion 3), hollow wall (mm;
 * none or 0 is solid) and tilt (up to 90° each way; 0 is upright). Returns
 * why it cannot be, or the part.
 */
function withForm(part: Part, patch: Partial<Pick<Part, "taper" | "profile" | "hollow" | "tilt">>): Part | string {
  const next: Part = { ...part };
  if (patch.taper !== undefined) {
    if (!Number.isFinite(patch.taper) || patch.taper < 0 || patch.taper > 4) return "A taper is between 0 (to a point) and 4.";
    if (Math.abs(patch.taper - 1) < 1e-3) delete next.taper;
    else next.taper = Math.round(patch.taper * 1_000) / 1_000;
  }
  if (patch.profile !== undefined) {
    const profile = cleanProfile(patch.profile);
    const need = next.shape === "extrude" ? 3 : 2;
    if (profile.length < need || profile.length > 96) return next.shape === "extrude" ? "An outline needs 3 to 96 points." : "A profile needs 2 to 96 points.";
    next.profile = profile;
  }
  if (patch.hollow !== undefined) {
    if (!patch.hollow) delete next.hollow;
    else if (!Number.isFinite(patch.hollow) || patch.hollow < 1) return "A hollow's wall is at least 1 mm.";
    else if (patch.hollow * 2 >= Math.min(next.size.w, next.size.d)) return "The wall would fill the part; make it thinner.";
    else next.hollow = Math.round(patch.hollow);
  }
  if (patch.tilt !== undefined) {
    const x = Math.round((patch.tilt?.x ?? 0) * 10) / 10;
    const y = Math.round((patch.tilt?.y ?? 0) * 10) / 10;
    if (![x, y].every((v) => Number.isFinite(v) && Math.abs(v) <= 90)) return "A tilt is up to 90° each way.";
    if (!x && !y) delete next.tilt;
    else next.tilt = { ...(x ? { x } : {}), ...(y ? { y } : {}) };
  }
  if (next.shape !== "mesh") delete next.mesh;
  if (next.shape !== "lathe" && next.shape !== "extrude") delete next.profile;
  if (next.shape !== "cylinder" && next.shape !== "lathe") delete next.hollow;
  if (next.shape !== "box" && next.shape !== "cylinder" && next.shape !== "extrude") delete next.taper;
  return next;
}

/** Where a new part goes when no place is given: on the floor to the right of the others, so it is never lost inside them. */
function besideParts(bp: Blueprint, size: Size3): { x: number; y: number; z: number } {
  if (!bp.parts.length) return { x: 0, y: 0, z: 0 };
  const right = Math.max(...bp.parts.map((p) => p.at.x + Math.max(p.size.w, p.size.d) / 2));
  return { x: Math.round(right + 100 + size.w / 2), y: 0, z: 0 };
}

function sizeProblem(s: Size3): string | null {
  return [s.w, s.d, s.h].every((v) => Number.isFinite(v) && v >= 1 && v <= MAX_SIZE) ? null : "Sizes must be between 1 mm and 100 m.";
}

export function blankBlueprint(name: string, kind: "object" | "wall" = "object", category: BlueprintCategory = kind === "wall" ? "Walls" : "Other"): Omit<Blueprint, "id"> {
  if (kind === "wall") {
    const layers: WallLayer[] = [
      { name: "Board", thickness: 12, material: "std:white-paint" },
      { name: "Stud", thickness: 76, material: "std:plaster" },
      { name: "Board", thickness: 12, material: "std:white-paint" },
    ];
    return { name, kind, category, type: "box", size: { w: 1_000, d: wallThickness(layers), h: 2_700 }, parts: wallParts(layers, 1_000, 2_700), layers, symbol: "parts", revision: 0 };
  }
  return {
    name,
    kind,
    category,
    type: "box",
    size: { w: 1_000, d: 600, h: 750 },
    parts: [{ id: newPartId(), name: "Box", shape: "box", at: { x: 0, y: 0, z: 0 }, size: { w: 1_000, d: 600, h: 750 }, rotation: 0, material: "std:oak" }],
    symbol: "parts",
    revision: 0,
  };
}

/** A copy to save as the practice's own; defaults cannot be changed in place. */
export function copyOf(source: Blueprint, name = `${source.name} (copy)`): Omit<Blueprint, "id"> {
  return {
    ...structuredClone(source),
    name: name.slice(0, 120),
    basedOn: source.id,
    revision: 0,
    updatedAt: undefined,
    updatedBy: undefined,
    createdBy: undefined,
  };
}

export function updateBlueprint(bp: Blueprint, patch: Partial<Pick<Blueprint, "name" | "category" | "type" | "symbol" | "description" | "tags">> & { size?: Partial<Size3> }): BlueprintEdit {
  const next: Blueprint = { ...bp, ...patch, size: { ...bp.size, ...patch.size } };
  if (patch.name != null && !patch.name.trim()) return fail("Give it a name.");
  const problem = sizeProblem(next.size);
  if (problem) return fail(problem);
  if (bp.kind === "wall" && patch.size) next.parts = wallParts(bp.layers ?? [], next.size.w, next.size.h);
  const changes = Object.keys(patch).filter((k) => JSON.stringify((patch as Record<string, unknown>)[k]) !== JSON.stringify((bp as unknown as Record<string, unknown>)[k]));
  if (!changes.length) return { ok: true, blueprint: bp, summary: "" };
  return { ok: true, blueprint: next, summary: `${next.name}: ${changes.join(", ")} changed` };
}

/** Stretches every part with the blueprint, so its look keeps its proportions at a new size. */
export function resizeBlueprint(bp: Blueprint, size: Size3): BlueprintEdit {
  const problem = sizeProblem(size);
  if (problem) return fail(problem);
  if (bp.kind === "wall") return updateBlueprint(bp, { size: { w: size.w, h: size.h } });
  const kx = size.w / bp.size.w;
  const ky = size.d / bp.size.d;
  const kz = size.h / bp.size.h;
  const parts = bp.parts.map((p) => {
    const r = (p.rotation * Math.PI) / 180;
    const ax = Math.hypot(kx * Math.cos(r), ky * Math.sin(r));
    const ay = Math.hypot(kx * Math.sin(r), ky * Math.cos(r));
    return { ...p, at: { x: p.at.x * kx, y: p.at.y * ky, z: p.at.z * kz }, size: { w: p.size.w * ax, d: p.size.d * ay, h: p.size.h * kz } };
  });
  return { ok: true, blueprint: { ...bp, size, parts }, summary: `${bp.name} resized to ${Math.round(size.w)} × ${Math.round(size.d)} × ${Math.round(size.h)} mm` };
}

export function addShape(bp: Blueprint, shape: PartShape, init: Partial<Omit<Part, "id" | "shape" | "blueprintId">> = {}): BlueprintEdit {
  if (bp.kind === "wall") return fail("A wall type is made of layers; change its layers instead.");
  if (bp.parts.length >= 400) return fail("A blueprint can have up to 400 parts. Group some into a blueprint of their own and nest it.");
  const size = init.size ?? { w: Math.min(400, bp.size.w), d: Math.min(400, bp.size.d), h: Math.min(400, bp.size.h) };
  const problem = sizeProblem(size);
  if (problem) return fail(problem);
  const part: Part = {
    id: newPartId(),
    name: init.name ?? SHAPE_NAMES[shape],
    shape,
    at: init.at ?? besideParts(bp, size),
    size,
    rotation: init.rotation ?? 0,
    material: init.material ?? "std:warm-grey-paint",
    ...(init.radius ? { radius: init.radius } : {}),
    ...(shape === "lathe" || shape === "extrude" ? { profile: init.profile ?? defaultProfile(shape) } : {}),
  };
  const formed = withForm(part, init);
  if (typeof formed === "string") return fail(formed);
  return { ok: true, blueprint: { ...bp, parts: [...bp.parts, formed] }, summary: `${part.name} added to ${bp.name}`, partId: part.id };
}

/** Nests another blueprint as a part; it keeps following that blueprint's changes. */
export function nestBlueprint(lib: Resolver, bp: Blueprint, childId: string, init: Partial<Omit<Part, "id" | "shape" | "blueprintId">> = {}): BlueprintEdit {
  if (bp.kind === "wall") return fail("A wall type is made of layers; nest it in an object blueprint instead.");
  const child = lib.blueprint(childId);
  if (!child) return fail("That blueprint is not in the library.");
  if (wouldLoop(lib, bp.id, childId)) return fail(`${child.name} already contains ${bp.name}, so it cannot go inside it.`);
  if (bp.parts.length >= 400) return fail("A blueprint can have up to 400 parts.");
  const part: Part = { id: newPartId(), name: init.name ?? child.name, blueprintId: childId, at: init.at ?? besideParts(bp, init.size ?? child.size), size: init.size ?? { ...child.size }, rotation: init.rotation ?? 0, ...(init.material ? { material: init.material } : {}) };
  const problem = sizeProblem(part.size);
  if (problem) return fail(problem);
  return { ok: true, blueprint: { ...bp, parts: [...bp.parts, part] }, summary: `${child.name} nested in ${bp.name}`, partId: part.id };
}

export function updatePart(lib: Resolver, bp: Blueprint, partId: string, patch: Partial<Omit<Part, "id">>): BlueprintEdit {
  if (bp.kind === "wall") return fail("A wall type is made of layers; change its layers instead.");
  const part = bp.parts.find((p) => p.id === partId);
  if (!part) return fail("That part is no longer in the blueprint.");
  const next: Part = { ...part, ...patch, at: { ...part.at, ...patch.at }, size: { ...part.size, ...patch.size } };
  if (patch.blueprintId) {
    delete next.shape;
    if (!lib.blueprint(patch.blueprintId)) return fail("That blueprint is not in the library.");
    if (wouldLoop(lib, bp.id, patch.blueprintId)) return fail("That would put the blueprint inside itself.");
  }
  if (patch.shape) delete next.blueprintId;
  // Turned into a mesh, a shape keeps its look as points and faces to edit.
  if (patch.shape === "mesh" && part.shape !== "mesh") {
    const made = toMesh({ ...part, ...next, shape: part.shape });
    if (typeof made === "string") return fail(made);
    return { ok: true, blueprint: { ...bp, parts: bp.parts.map((p) => (p.id === partId ? made : p)) }, summary: `${next.name ?? "Part"} turned into a mesh`, partId };
  }
  if (patch.material === "") delete next.material;
  if (patch.radius === 0) delete next.radius;
  // A shape changed to a lathe or extrusion starts from a profile.
  if ((next.shape === "lathe" || next.shape === "extrude") && patch.profile === undefined && (!next.profile || patch.shape)) next.profile = patch.shape && patch.shape !== part.shape ? defaultProfile(next.shape) : (next.profile ?? defaultProfile(next.shape));
  const problem = sizeProblem(next.size);
  if (problem) return fail(problem);
  if (![next.at.x, next.at.y, next.at.z, next.rotation].every((v) => Number.isFinite(v) && Math.abs(v) <= MAX_SIZE)) return fail("That position is out of range.");
  next.rotation = Math.round((((next.rotation % 360) + 360) % 360) * 10) / 10;
  const formed = next.blueprintId ? next : withForm(next, patch);
  if (typeof formed === "string") return fail(formed);
  return { ok: true, blueprint: { ...bp, parts: bp.parts.map((p) => (p.id === partId ? formed : p)) }, summary: `${next.name ?? "Part"} changed in ${bp.name}`, partId };
}

export function removePart(bp: Blueprint, partId: string): BlueprintEdit {
  const part = bp.parts.find((p) => p.id === partId);
  if (!part) return fail("That part is no longer in the blueprint.");
  if (bp.kind === "wall") return fail("A wall type is made of layers; remove a layer instead.");
  return { ok: true, blueprint: { ...bp, parts: bp.parts.filter((p) => p.id !== partId) }, summary: `${part.name ?? "Part"} removed from ${bp.name}` };
}

export function duplicatePart(bp: Blueprint, partId: string, offset = { x: 100, y: 0, z: 0 }): BlueprintEdit {
  const part = bp.parts.find((p) => p.id === partId);
  if (!part) return fail("That part is no longer in the blueprint.");
  if (bp.kind === "wall") return fail("A wall type is made of layers.");
  const copy: Part = { ...structuredClone(part), id: newPartId(), at: { x: part.at.x + offset.x, y: part.at.y + offset.y, z: part.at.z + offset.z } };
  return { ok: true, blueprint: { ...bp, parts: [...bp.parts, copy] }, summary: `${part.name ?? "Part"} copied in ${bp.name}`, partId: copy.id };
}

/** Mirrors a part across the blueprint's middle, left to right or front to back. */
export function mirrorPart(bp: Blueprint, partId: string, axis: "x" | "y", copy = true): BlueprintEdit {
  const part = bp.parts.find((p) => p.id === partId);
  if (!part) return fail("That part is no longer in the blueprint.");
  const mirrored: Part = {
    ...structuredClone(part),
    id: copy ? newPartId() : part.id,
    at: axis === "x" ? { ...part.at, x: -part.at.x } : { ...part.at, y: -part.at.y },
    rotation: (((axis === "x" ? -part.rotation : 180 - part.rotation) % 360) + 360) % 360,
  };
  // Either way the part's own frame is flipped across: the outline left to right, and a lean to the side.
  if (part.shape === "extrude" && part.profile) mirrored.profile = part.profile.map(([u, v]) => [1 - u, v]);
  if (part.tilt?.y) mirrored.tilt = { ...part.tilt, y: -part.tilt.y };
  if (part.shape === "mesh" && part.mesh) mirrored.mesh = { v: part.mesh.v.map(([u, v, t]) => [1 - u, v, t]), f: part.mesh.f.map((f) => [...f].reverse()) };
  const parts = copy ? [...bp.parts, mirrored] : bp.parts.map((p) => (p.id === partId ? mirrored : p));
  return { ok: true, blueprint: { ...bp, parts }, summary: `${part.name ?? "Part"} mirrored in ${bp.name}`, partId: mirrored.id };
}

/** Repeats a part in a row: count copies in all, each step apart. */
export function arrayPart(bp: Blueprint, partId: string, count: number, step: { x: number; y: number; z: number }): BlueprintEdit {
  const part = bp.parts.find((p) => p.id === partId);
  if (!part) return fail("That part is no longer in the blueprint.");
  if (!Number.isInteger(count) || count < 2 || count > 100) return fail("Choose between 2 and 100 copies.");
  if (bp.parts.length + count - 1 > 400) return fail("A blueprint can have up to 400 parts.");
  const copies: Part[] = Array.from({ length: count - 1 }, (_, i) => ({ ...structuredClone(part), id: newPartId(), at: { x: part.at.x + step.x * (i + 1), y: part.at.y + step.y * (i + 1), z: part.at.z + step.z * (i + 1) } }));
  return { ok: true, blueprint: { ...bp, parts: [...bp.parts, ...copies] }, summary: `${part.name ?? "Part"} repeated ${count} times in ${bp.name}` };
}

/** Sets a wall type's layers; its parts and thickness follow. */
export function setLayers(bp: Blueprint, layers: WallLayer[]): BlueprintEdit {
  if (bp.kind !== "wall") return fail("Only wall types have layers.");
  if (!layers.length) return fail("A wall type needs at least one layer.");
  if (layers.length > 20) return fail("A wall type can have up to 20 layers.");
  if (!layers.every((l) => Number.isFinite(l.thickness) && l.thickness >= 1 && l.thickness <= 1_500)) return fail("Each layer must be between 1 and 1,500 mm thick.");
  const thickness = wallThickness(layers);
  if (thickness > 1_500) return fail("A wall can be up to 1,500 mm thick.");
  return {
    ok: true,
    blueprint: { ...bp, layers, size: { ...bp.size, d: thickness }, parts: wallParts(layers, bp.size.w, bp.size.h) },
    summary: `${bp.name} layers set, ${thickness} mm thick`,
  };
}

/** Sets its size to what its parts take up, and centres them on its footprint, standing on the floor. */
export function fitToParts(lib: Resolver, bp: Blueprint): BlueprintEdit {
  if (bp.kind === "wall") return fail("A wall type's size comes from its layers.");
  const e = extent(flatten(lib, bp));
  if (!e) return fail("Add a part first.");
  const cx = (e.minX + e.maxX) / 2;
  const cy = (e.minY + e.maxY) / 2;
  const size = { w: Math.max(1, e.maxX - e.minX), d: Math.max(1, e.maxY - e.minY), h: Math.max(1, e.maxZ - Math.min(0, e.minZ)) };
  const parts = bp.parts.map((p) => ({ ...p, at: { x: p.at.x - cx, y: p.at.y - cy, z: p.at.z - Math.min(0, e.minZ) } }));
  return { ok: true, blueprint: { ...bp, size, parts }, summary: `${bp.name} fitted to its parts` };
}

/** Problems that would make it draw wrongly: loops, missing nested blueprints or materials. */
export function problems(lib: Resolver, bp: Blueprint): string[] {
  const out: string[] = [];
  for (const p of bp.parts) {
    if (p.blueprintId && !lib.blueprint(p.blueprintId)) out.push(`${p.name ?? "A part"} uses a blueprint that was removed; it shows as a box.`);
    if (p.blueprintId && wouldLoop(lib, bp.id, p.blueprintId)) out.push(`${p.name ?? "A part"} contains this blueprint, so it is left out.`);
    if (p.material && !lib.material(p.material)) out.push(`${p.name ?? "A part"} uses a material that was removed.`);
  }
  return out;
}

/**
 * Moves, turns or sizes parts together, as dragging the 3D handles does: a
 * move in mm, a turn in degrees about the middle of their footprints, and size
 * factors about that middle and their lowest underside. Each part grows along
 * its own axes, so a part turned a quarter takes the across factor through.
 */
export function transformParts(
  bp: Blueprint,
  partIds: string[],
  change: { move?: { x: number; y: number; z: number }; turn?: number; scale?: { x: number; y: number; z: number } }
): BlueprintEdit {
  if (bp.kind === "wall") return fail("A wall type is made of layers; change its layers instead.");
  const picked = bp.parts.filter((p) => partIds.includes(p.id));
  if (!picked.length) return fail("Those parts are no longer in the blueprint.");
  const cx = picked.reduce((s, p) => s + p.at.x, 0) / picked.length;
  const cy = picked.reduce((s, p) => s + p.at.y, 0) / picked.length;
  const z0 = Math.min(...picked.map((p) => p.at.z));
  const move = change.move ?? { x: 0, y: 0, z: 0 };
  const turn = change.turn ?? 0;
  const k = change.scale ?? { x: 1, y: 1, z: 1 };
  if (![k.x, k.y, k.z].every((v) => Number.isFinite(v) && v > 0)) return fail("A size cannot shrink to nothing.");
  const a = (turn * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const r1 = (v: number) => Math.round(v) || 0;
  let next = bp.parts;
  for (const p of picked) {
    const quarter = Math.round((((p.rotation % 180) + 180) % 180) / 90) % 2 === 1;
    const [kw, kd] = quarter ? [k.y, k.x] : [k.x, k.y];
    let x = cx + (p.at.x - cx) * k.x;
    let y = cy + (p.at.y - cy) * k.y;
    const z = z0 + (p.at.z - z0) * k.z;
    if (turn) [x, y] = [cx + (x - cx) * c - (y - cy) * s, cy + (x - cx) * s + (y - cy) * c];
    const moved: Part = {
      ...p,
      at: { x: r1(x + move.x), y: r1(y + move.y), z: r1(z + move.z) },
      size: { w: r1(p.size.w * kw), d: r1(p.size.d * kd), h: r1(p.size.h * k.z) },
      rotation: Math.round((((p.rotation + turn) % 360) + 360) % 360 * 10) / 10,
    };
    if (moved.hollow && moved.hollow * 2 >= Math.min(moved.size.w, moved.size.d)) moved.hollow = Math.max(1, Math.floor(Math.min(moved.size.w, moved.size.d) / 2) - 1);
    const problem = sizeProblem(moved.size);
    if (problem) return fail(problem);
    next = next.map((q) => (q.id === p.id ? moved : q));
  }
  const what = picked.length === 1 ? (picked[0].name ?? "Part") : `${picked.length} parts`;
  const verb = turn ? "turned" : change.scale && (k.x !== 1 || k.y !== 1 || k.z !== 1) ? "resized" : "moved";
  return { ok: true, blueprint: { ...bp, parts: next }, summary: `${what} ${verb} in ${bp.name}`, ...(picked.length === 1 ? { partId: picked[0].id } : {}) };
}

/** An edit to a mesh part's points and faces, in the blueprint's millimetres. */
export type PointEdit =
  | ({ op: "sculpt" } & SculptStroke)
  | { op: "convert" }
  | { op: "move"; points: number[]; by: Vec3mm }
  | { op: "set"; point: number; at: Partial<Vec3mm> }
  | { op: "delete"; points: number[] }
  | { op: "split"; points: number[] }
  | { op: "face"; points: number[] }
  | { op: "merge"; points: number[] }
  | { op: "delete_faces"; faces: number[] }
  | { op: "flip"; faces: number[] }
  | { op: "extrude"; faces: number[]; distance: number }
  | { op: "inset"; faces: number[]; distance: number }
  | { op: "subdivide"; faces?: number[] }
  | { op: "align_points"; points: number[]; axis: "x" | "y" | "z"; mode?: "min" | "center" | "max" }
  | { op: "weld"; threshold?: number }
  | { op: "add_point_on_face"; face: number; offset?: number }
  | { op: "scale_points"; points: number[]; factor: number }
  | { op: "rotate_points"; points: number[]; axis: "x" | "y" | "z"; angle: number }
  | { op: "smooth"; points: number[]; iterations?: number; factor?: number }
  | { op: "triangulate"; faces?: number[] };

const POINT_SUMMARY: Record<PointEdit["op"], string> = {
  sculpt: "sculpt brush applied",
  convert: "turned into a mesh",
  move: "points moved",
  set: "point placed",
  delete: "points removed",
  split: "edges split",
  face: "face added",
  merge: "points merged",
  delete_faces: "faces removed",
  flip: "faces turned over",
  extrude: "faces pushed out",
  inset: "faces inset",
  subdivide: "faces subdivided",
  align_points: "points aligned",
  weld: "points welded",
  add_point_on_face: "vertex added on face",
  scale_points: "points scaled",
  rotate_points: "points rotated",
  smooth: "points smoothed",
  triangulate: "faces triangulated",
};

/**
 * Edits a part's points and faces: any shape is turned into a mesh first, so
 * its look is kept and every point can then be moved, placed exactly, added
 * (by splitting edges), merged or removed, and faces made, removed, turned
 * over or pushed and pulled.
 */
export function editPoints(bp: Blueprint, partId: string, e: PointEdit): BlueprintEdit {
  if (bp.kind === "wall") return fail("A wall type is made of layers; change its layers instead.");
  const part = bp.parts.find((p) => p.id === partId);
  if (!part) return fail("That part is no longer in the blueprint.");
  let next: Part | string;
  let points: number[] | undefined;
  switch (e.op) {
    case "sculpt":
      next = sculptStroke(part, e);
      break;
    case "convert":
      next = toMesh(part);
      break;
    case "move":
      next = movePoints(part, e.points, e.by);
      points = e.points;
      break;
    case "set":
      next = setPoint(part, e.point, e.at);
      points = [e.point];
      break;
    case "delete":
      next = deletePoints(part, e.points);
      points = [];
      break;
    case "split": {
      const r = splitEdges(part, e.points);
      next = typeof r === "string" ? r : r.part;
      if (typeof r !== "string") points = r.added;
      break;
    }
    case "face":
      next = makeFace(part, e.points);
      points = e.points;
      break;
    case "merge":
      next = mergePoints(part, e.points);
      points = [];
      break;
    case "delete_faces":
      next = deleteFaces(part, e.faces);
      points = [];
      break;
    case "flip":
      next = flipFaces(part, e.faces);
      break;
    case "extrude": {
      const r = extrudeFaces(part, e.faces, e.distance);
      next = typeof r === "string" ? r : r.part;
      if (typeof r !== "string") points = r.points;
      break;
    }
    case "inset": {
      const r = insetFaces(part, e.faces, e.distance);
      next = typeof r === "string" ? r : r.part;
      if (typeof r !== "string") points = r.points;
      break;
    }
    case "subdivide":
      next = subdivideFaces(part, e.faces);
      break;
    case "align_points":
      next = alignPoints(part, e.points, e.axis, e.mode);
      points = e.points;
      break;
    case "weld":
      next = weldPoints(part, e.threshold);
      break;
    case "add_point_on_face": {
      const r = addVertexOnFace(part, e.face, e.offset ?? 0);
      next = typeof r === "string" ? r : r.part;
      if (typeof r !== "string") points = [r.point];
      break;
    }
    case "scale_points":
      next = scalePoints(part, e.points, e.factor);
      points = e.points;
      break;
    case "rotate_points":
      next = rotatePoints(part, e.points, e.axis, e.angle);
      points = e.points;
      break;
    case "smooth":
      next = smoothPoints(part, e.points, e.iterations, e.factor);
      points = e.points;
      break;
    case "triangulate":
      next = triangulateFaces(part, e.faces);
      break;
  }
  if (typeof next === "string") return fail(next);
  const made = next;
  return { ok: true, blueprint: { ...bp, parts: bp.parts.map((p) => (p.id === partId ? made : p)) }, summary: `${part.name ?? "Part"}: ${POINT_SUMMARY[e.op]}`, partId, ...(points ? { points } : {}) };
}

/** Aligns multiple selected parts along X, Y, or Z (min, center, max). */
export function alignParts(bp: Blueprint, partIds: string[], axis: "x" | "y" | "z", mode: "min" | "center" | "max" = "center"): BlueprintEdit {
  const chosen = bp.parts.filter((p) => partIds.includes(p.id));
  if (chosen.length < 2) return fail("Pick two or more parts to align.");

  const getSpan = (p: Part) => {
    if (axis === "x") return { min: p.at.x - p.size.w / 2, center: p.at.x, max: p.at.x + p.size.w / 2 };
    if (axis === "y") return { min: p.at.y - p.size.d / 2, center: p.at.y, max: p.at.y + p.size.d / 2 };
    return { min: p.at.z, center: p.at.z + p.size.h / 2, max: p.at.z + p.size.h };
  };

  const spans = chosen.map(getSpan);
  const target =
    mode === "min"
      ? Math.min(...spans.map((s) => s.min))
      : mode === "max"
      ? Math.max(...spans.map((s) => s.max))
      : (Math.min(...spans.map((s) => s.min)) + Math.max(...spans.map((s) => s.max))) / 2;

  const nextParts = bp.parts.map((p) => {
    if (!partIds.includes(p.id)) return p;
    const cur = getSpan(p);
    const delta = mode === "min" ? target - cur.min : mode === "max" ? target - cur.max : target - cur.center;
    if (axis === "x") return { ...p, at: { ...p.at, x: Math.round(p.at.x + delta) } };
    if (axis === "y") return { ...p, at: { ...p.at, y: Math.round(p.at.y + delta) } };
    return { ...p, at: { ...p.at, z: Math.round(p.at.z + delta) } };
  });

  return { ok: true, blueprint: { ...bp, parts: nextParts }, summary: `Aligned ${chosen.length} parts on ${axis.toUpperCase()}` };
}

/** Drops selected parts so their lowest point lands flat on the floor (Z = 0). */
export function dropToFloor(bp: Blueprint, partIds: string[]): BlueprintEdit {
  const chosen = bp.parts.filter((p) => partIds.includes(p.id));
  if (!chosen.length) return fail("Pick at least one part.");

  const minZ = Math.min(...chosen.map((p) => p.at.z));
  const shift = -minZ;
  const nextParts = bp.parts.map((p) => (partIds.includes(p.id) ? { ...p, at: { ...p.at, z: Math.round(p.at.z + shift) } } : p));
  return { ok: true, blueprint: { ...bp, parts: nextParts }, summary: `Dropped ${chosen.length} part${chosen.length === 1 ? "" : "s"} to floor` };
}

/** Distributes 3 or more parts evenly along an axis. */
export function distributeParts(bp: Blueprint, partIds: string[], axis: "x" | "y" | "z"): BlueprintEdit {
  const chosen = bp.parts.filter((p) => partIds.includes(p.id));
  if (chosen.length < 3) return fail("Pick 3 or more parts to distribute evenly.");

  const getCoord = (p: Part) => (axis === "x" ? p.at.x : axis === "y" ? p.at.y : p.at.z);
  const sorted = [...chosen].sort((a, b) => getCoord(a) - getCoord(b));
  const start = getCoord(sorted[0]);
  const end = getCoord(sorted[sorted.length - 1]);
  const step = (end - start) / (sorted.length - 1);

  const targetMap = new Map<string, number>();
  sorted.forEach((p, i) => targetMap.set(p.id, Math.round(start + i * step)));

  const nextParts = bp.parts.map((p) => {
    const t = targetMap.get(p.id);
    if (t === undefined) return p;
    return { ...p, at: { ...p.at, [axis]: t } };
  });

  return { ok: true, blueprint: { ...bp, parts: nextParts }, summary: `Distributed ${chosen.length} parts along ${axis.toUpperCase()}` };
}

/** Repeats a part in a circle around origin (0, 0) with radial rotation. */
export function radialArrayPart(bp: Blueprint, partId: string, count: number, customRadius?: number): BlueprintEdit {
  const part = bp.parts.find((p) => p.id === partId);
  if (!part) return fail("That part is no longer in the blueprint.");
  const n = Math.max(2, Math.min(36, count));
  const curR = Math.hypot(part.at.x, part.at.y);
  const r = customRadius ?? (curR || Math.max(part.size.w, part.size.d) * 1.5);
  const baseAngle = Math.atan2(part.at.y, part.at.x);

  const added: Part[] = [];
  for (let i = 1; i < n; i++) {
    const a = baseAngle + (i / n) * Math.PI * 2;
    const deg = Math.round((((part.rotation + (i / n) * 360) % 360) + 360) % 360 * 10) / 10;
    added.push({
      ...structuredClone(part),
      id: newPartId(),
      name: `${part.name ?? "Part"} ${i + 1}`,
      at: { x: Math.round(Math.cos(a) * r), y: Math.round(Math.sin(a) * r), z: part.at.z },
      rotation: deg,
    });
  }

  return { ok: true, blueprint: { ...bp, parts: [...bp.parts, ...added] }, summary: `Radial pattern: ${n} copies of ${part.name ?? "part"}` };
}

/** Mirrors a part vertically across Z (ground or height midpoint). */
export function mirrorPartZ(bp: Blueprint, partId: string, copy = true): BlueprintEdit {
  const part = bp.parts.find((p) => p.id === partId);
  if (!part) return fail("That part is no longer in the blueprint.");

  const midZ = bp.size.h / 2;
  const newZ = Math.round(2 * midZ - (part.at.z + part.size.h));
  const mirrored: Part = {
    ...structuredClone(part),
    id: copy ? newPartId() : part.id,
    name: copy ? `${part.name ?? "Part"} (mirrored)` : part.name,
    at: { ...part.at, z: Math.max(0, newZ) },
    tilt: part.tilt ? { ...(part.tilt.x ? { x: -part.tilt.x } : {}), ...(part.tilt.y ? { y: -part.tilt.y } : {}) } : undefined,
  };

  const nextParts = copy ? [...bp.parts, mirrored] : bp.parts.map((p) => (p.id === partId ? mirrored : p));
  return { ok: true, blueprint: { ...bp, parts: nextParts }, summary: `Mirrored ${part.name ?? "part"} vertically`, partId: mirrored.id };
}

/** Joins multiple parts into a single unified compound mesh part (Boolean Union / Join). */
export function joinParts(bp: Blueprint, partIds: string[]): BlueprintEdit {
  const chosen = bp.parts.filter((p) => partIds.includes(p.id) && !p.blueprintId);
  if (chosen.length < 2) return fail("Pick two or more shape parts to join into one mesh.");

  const allPoints: Vec3mm[] = [];
  const allFaces: number[][] = [];

  for (const p of chosen) {
    const m = toMesh(p);
    if (typeof m === "string") return fail(m);
    const baseIndex = allPoints.length;
    const meshPts = meshPoints(m);
    allPoints.push(...meshPts);
    if (m.mesh) {
      for (const face of m.mesh.f) {
        allFaces.push(face.map((idx) => baseIndex + idx));
      }
    }
  }

  const xs = allPoints.map((p) => p.x);
  const ys = allPoints.map((p) => p.y);
  const zs = allPoints.map((p) => p.z);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const minZ = Math.min(...zs);
  const maxZ = Math.max(...zs);

  const w = Math.max(1, maxX - minX);
  const d = Math.max(1, maxY - minY);
  const h = Math.max(1, maxZ - minZ);

  const cx = Math.round(minX + w / 2);
  const cy = Math.round(minY + d / 2);
  const cz = Math.round(minZ);

  const r6 = (n: number) => Math.round(n * 1e6) / 1e6;
  const normalizedV: [number, number, number][] = allPoints.map((p) => [
    r6((p.x - minX) / w),
    r6((p.y - minY) / d),
    r6((p.z - minZ) / h),
  ]);

  const newPart: Part = {
    id: newPartId(),
    name: "Joined Mesh",
    shape: "mesh",
    at: { x: cx, y: cy, z: cz },
    size: { w: Math.round(w), d: Math.round(d), h: Math.round(h) },
    rotation: 0,
    material: chosen[0].material ?? "std:warm-grey-paint",
    mesh: { v: normalizedV, f: allFaces },
  };

  const nextParts = [...bp.parts.filter((p) => !partIds.includes(p.id)), newPart];
  return { ok: true, blueprint: { ...bp, parts: nextParts }, summary: `Joined ${chosen.length} parts into a single mesh`, partId: newPart.id };
}

/** Separates disconnected mesh islands in a mesh part into independent parts. */
export function separatePart(bp: Blueprint, partId: string): BlueprintEdit {
  const part = bp.parts.find((p) => p.id === partId);
  if (!part || part.shape !== "mesh" || !part.mesh) return fail("Pick a mesh part to separate.");

  const m = part.mesh;
  const adj = new Map<number, Set<number>>();
  for (let i = 0; i < m.f.length; i++) adj.set(i, new Set());

  // Build face adjacency via shared vertices
  const vertToFaces = new Map<number, number[]>();
  m.f.forEach((f, fIdx) => {
    for (const v of f) {
      const list = vertToFaces.get(v) ?? [];
      list.push(fIdx);
      vertToFaces.set(v, list);
    }
  });

  for (const faces of vertToFaces.values()) {
    for (let i = 0; i < faces.length; i++) {
      for (let j = i + 1; j < faces.length; j++) {
        adj.get(faces[i])!.add(faces[j]);
        adj.get(faces[j])!.add(faces[i]);
      }
    }
  }

  // Find connected components of faces
  const visited = new Set<number>();
  const islands: number[][] = [];

  for (let i = 0; i < m.f.length; i++) {
    if (visited.has(i)) continue;
    const island: number[] = [];
    const queue = [i];
    visited.add(i);
    while (queue.length) {
      const curr = queue.shift()!;
      island.push(curr);
      for (const neighbor of adj.get(curr) ?? []) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          queue.push(neighbor);
        }
      }
    }
    islands.push(island);
  }

  if (islands.length <= 1) return fail("This mesh is already a single connected piece.");

  // For each island, build a fitted part
  const worldPoints = meshPoints(part);
  const created: Part[] = [];

  for (let idx = 0; idx < islands.length; idx++) {
    const islandFaces = islands[idx].map((fIdx) => m.f[fIdx]);
    const usedVerts = [...new Set(islandFaces.flat())].sort((a, b) => a - b);
    const remap = new Map(usedVerts.map((v, k) => [v, k]));

    const islandWorldPts = usedVerts.map((v) => worldPoints[v]);
    const xs = islandWorldPts.map((p) => p.x);
    const ys = islandWorldPts.map((p) => p.y);
    const zs = islandWorldPts.map((p) => p.z);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const minZ = Math.min(...zs);
    const maxZ = Math.max(...zs);

    const w = Math.max(1, maxX - minX);
    const d = Math.max(1, maxY - minY);
    const h = Math.max(1, maxZ - minZ);

    const cx = Math.round(minX + w / 2);
    const cy = Math.round(minY + d / 2);
    const cz = Math.round(minZ);

    const r6 = (n: number) => Math.round(n * 1e6) / 1e6;
    const localV: [number, number, number][] = islandWorldPts.map((p) => [
      r6((p.x - minX) / w),
      r6((p.y - minY) / d),
      r6((p.z - minZ) / h),
    ]);
    const remappedF = islandFaces.map((f) => f.map((v) => remap.get(v)!));

    created.push({
      id: newPartId(),
      name: `${part.name ?? "Part"} (piece ${idx + 1})`,
      shape: "mesh",
      at: { x: cx, y: cy, z: cz },
      size: { w: Math.round(w), d: Math.round(d), h: Math.round(h) },
      rotation: 0,
      material: part.material,
      mesh: { v: localV, f: remappedF },
    });
  }

  const nextParts = [...bp.parts.filter((p) => p.id !== partId), ...created];
  return { ok: true, blueprint: { ...bp, parts: nextParts }, summary: `Separated into ${created.length} parts` };
}
