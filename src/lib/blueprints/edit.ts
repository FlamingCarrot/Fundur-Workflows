import { wallParts, wallThickness } from "./defaults";
import { extent, flatten, wouldLoop, type Resolver } from "./resolve";
import type { Blueprint, BlueprintCategory, Part, PartShape, Size3, WallLayer } from "./types";

/**
 * Edits to a blueprint, each a pure function returning the changed blueprint
 * and a line saying what changed, or why it cannot be done. The blueprint
 * editor and the assistant make the same edits.
 */

export type BlueprintEdit = { ok: true; blueprint: Blueprint; summary: string; partId?: string } | { ok: false; error: string };

const fail = (error: string): BlueprintEdit => ({ ok: false, error });
const MAX_SIZE = 100_000;
const newPartId = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10));

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
  const part: Part = { id: newPartId(), name: init.name ?? shape[0].toUpperCase() + shape.slice(1), shape, at: init.at ?? { x: 0, y: 0, z: 0 }, size, rotation: init.rotation ?? 0, material: init.material ?? "std:warm-grey-paint", ...(init.radius ? { radius: init.radius } : {}) };
  return { ok: true, blueprint: { ...bp, parts: [...bp.parts, part] }, summary: `${part.name} added to ${bp.name}`, partId: part.id };
}

/** Nests another blueprint as a part; it keeps following that blueprint's changes. */
export function nestBlueprint(lib: Resolver, bp: Blueprint, childId: string, init: Partial<Omit<Part, "id" | "shape" | "blueprintId">> = {}): BlueprintEdit {
  if (bp.kind === "wall") return fail("A wall type is made of layers; nest it in an object blueprint instead.");
  const child = lib.blueprint(childId);
  if (!child) return fail("That blueprint is not in the library.");
  if (wouldLoop(lib, bp.id, childId)) return fail(`${child.name} already contains ${bp.name}, so it cannot go inside it.`);
  if (bp.parts.length >= 400) return fail("A blueprint can have up to 400 parts.");
  const part: Part = { id: newPartId(), name: init.name ?? child.name, blueprintId: childId, at: init.at ?? { x: 0, y: 0, z: 0 }, size: init.size ?? { ...child.size }, rotation: init.rotation ?? 0, ...(init.material ? { material: init.material } : {}) };
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
  if (patch.material === "") delete next.material;
  if (patch.radius === 0) delete next.radius;
  const problem = sizeProblem(next.size);
  if (problem) return fail(problem);
  if (![next.at.x, next.at.y, next.at.z, next.rotation].every((v) => Number.isFinite(v) && Math.abs(v) <= MAX_SIZE)) return fail("That position is out of range.");
  next.rotation = Math.round((((next.rotation % 360) + 360) % 360) * 10) / 10;
  return { ok: true, blueprint: { ...bp, parts: bp.parts.map((p) => (p.id === partId ? next : p)) }, summary: `${next.name ?? "Part"} changed in ${bp.name}`, partId };
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
