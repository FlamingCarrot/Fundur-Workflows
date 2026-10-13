import { LIMITS, itemName, mm, newId, type EditResult, type Item, type Plan, type PlanCamera, type Point, type Slice, type ViewStyle } from "@/lib/plan/geometry";
import { addItem } from "@/lib/plan/elements";
import { LIBRARY } from "@/lib/plan/library";
import { wallThickness } from "./defaults";
import { blueprintFor, extent, instanceShapes, isStandardType, type Resolver } from "./resolve";
import { itemHeight } from "./symbol";
import type { Blueprint, BlueprintCategory, Part } from "./types";

/**
 * The plan edits the design library adds: placing a blueprint, swapping an
 * item's blueprint, an item's height, lift and material, a wall's type, a
 * room's floor finish, and placed cameras. Each returns the new plan and a line
 * for the corrections log, like every other plan edit, so it is versioned and
 * undoable.
 */

const fail = (error: string): EditResult => ({ ok: false, error });
const same = (plan: Plan): EditResult => ({ ok: true, plan, summary: "" });

/** Puts a blueprint on the plan at its own size. */
export function placeBlueprint(plan: Plan, lib: Resolver, blueprintId: string, at: Point, levelId: string, rotation = 0): EditResult {
  const bp = lib.blueprint(blueprintId);
  if (!bp) return fail("That blueprint is not in the library.");
  if (bp.kind === "wall") return fail(`${bp.name} is a wall type. Draw a wall, then choose it as the wall's type.`);
  const type = LIBRARY.some((l) => l.type === bp.type) ? bp.type : "box";
  const r = addItem(plan, type, at, levelId, rotation);
  if (!r.ok) return r;
  const plain = isStandardType(bp);
  const items = r.plan.items.map((i): Item => (i.id === r.id ? { ...i, width: bp.size.w, depth: bp.size.d, ...(plain ? {} : { blueprintId: bp.id }) } : i));
  return { ...r, plan: { ...r.plan, items }, summary: `${bp.name} placed` };
}

/** Swaps what an item is, keeping where it is and how it is turned; its footprint too unless asked for the blueprint's size. */
export function setItemBlueprint(plan: Plan, lib: Resolver, itemId: string, blueprintId: string, useBlueprintSize = true): EditResult {
  const item = plan.items.find((i) => i.id === itemId);
  if (!item) return fail("That is no longer on the plan.");
  const bp = lib.blueprint(blueprintId);
  if (!bp) return fail("That blueprint is not in the library.");
  if (bp.kind === "wall") return fail("A wall type goes on a wall, not on furniture.");
  const type = LIBRARY.some((l) => l.type === bp.type) ? bp.type : "box";
  const next: Item = { ...item, type, ...(useBlueprintSize ? { width: bp.size.w, depth: bp.size.d } : {}) };
  delete next.height;
  if (isStandardType(bp)) delete next.blueprintId;
  else next.blueprintId = bp.id;
  if (JSON.stringify(next) === JSON.stringify(item)) return same(plan);
  return { ok: true, plan: { ...plan, items: plan.items.map((i) => (i.id === itemId ? next : i)) }, summary: `${itemName(item)} is now ${bp.name}` };
}

/** Height, lift off the floor and a material over the whole item. Null clears one. */
export function setItemLook(plan: Plan, lib: Resolver, itemId: string, patch: { height?: number | null; elevation?: number | null; material?: string | null }): EditResult {
  const item = plan.items.find((i) => i.id === itemId);
  if (!item) return fail("That is no longer on the plan.");
  const next: Item = { ...item };
  const parts: string[] = [];
  if (patch.height !== undefined) {
    if (patch.height === null) delete next.height;
    else if (!Number.isFinite(patch.height) || patch.height < 1 || patch.height > LIMITS.maxWall) return fail("Its height must be between 1 mm and 300 m.");
    else next.height = Math.round(patch.height);
    if (next.height !== item.height) parts.push(next.height ? `${mm(next.height)} high` : "back to its blueprint's height");
  }
  if (patch.elevation !== undefined) {
    if (!patch.elevation) delete next.elevation;
    else if (!Number.isFinite(patch.elevation) || Math.abs(patch.elevation) > LIMITS.maxWall) return fail("That lift is out of range.");
    else next.elevation = Math.round(patch.elevation);
    if (next.elevation !== item.elevation) parts.push(next.elevation ? `lifted ${mm(next.elevation)}` : "on the floor");
  }
  if (patch.material !== undefined) {
    if (!patch.material) delete next.material;
    else if (!lib.material(patch.material)) return fail("That material is not in the library.");
    else next.material = patch.material;
    if (next.material !== item.material) parts.push(next.material ? `finished in ${lib.material(next.material)!.name.toLowerCase()}` : "in its blueprint's materials");
  }
  if (!parts.length) return same(plan);
  return { ok: true, plan: { ...plan, items: plan.items.map((i) => (i.id === itemId ? next : i)) }, summary: `${itemName(item)} ${parts.join(", ")}` };
}

/** Gives a wall a type from the library (its thickness follows the type's layers), or takes it off. */
export function setWallType(plan: Plan, lib: Resolver, wallId: string, typeId: string | null): EditResult {
  const wall = plan.walls.find((w) => w.id === wallId);
  if (!wall) return fail("That wall is no longer on the plan.");
  if (!typeId) {
    if (!wall.typeId) return same(plan);
    const next = { ...wall };
    delete next.typeId;
    return { ok: true, plan: { ...plan, walls: plan.walls.map((w) => (w.id === wallId ? next : w)) }, summary: "Wall type removed; it keeps its thickness" };
  }
  const type = lib.blueprint(typeId);
  if (!type || type.kind !== "wall" || !type.layers?.length) return fail("Choose a wall type from the library.");
  const thickness = Math.max(LIMITS.minThickness, Math.min(LIMITS.maxThickness, wallThickness(type.layers)));
  if (wall.typeId === typeId && wall.thickness === thickness) return same(plan);
  return {
    ok: true,
    plan: { ...plan, walls: plan.walls.map((w) => (w.id === wallId ? { ...w, typeId, thickness } : w)) },
    summary: `Wall is now ${type.name}, ${mm(thickness)} thick`,
  };
}

/** Walls follow their type: when a type's layers change, every wall of that type takes the new thickness. */
export function syncWallTypes(plan: Plan, lib: Resolver): EditResult | null {
  let changed = 0;
  const names = new Set<string>();
  const walls = plan.walls.map((w) => {
    if (!w.typeId) return w;
    const type = lib.blueprint(w.typeId);
    if (!type?.layers?.length) return w;
    const thickness = Math.max(LIMITS.minThickness, Math.min(LIMITS.maxThickness, wallThickness(type.layers)));
    if (Math.abs(thickness - w.thickness) < 0.5) return w;
    changed += 1;
    names.add(type.name);
    return { ...w, thickness };
  });
  if (!changed) return null;
  return { ok: true, plan: { ...plan, walls }, summary: `${changed} wall${changed === 1 ? "" : "s"} updated to the latest ${[...names].join(", ")}` };
}

export function setRoomFloor(plan: Plan, lib: Resolver, roomId: string, materialId: string | null): EditResult {
  const room = plan.rooms.find((r) => r.id === roomId);
  if (!room) return fail("That room is no longer on the plan.");
  if (materialId && !lib.material(materialId)) return fail("That material is not in the library.");
  if ((room.floorMaterial ?? null) === materialId) return same(plan);
  const next = { ...room };
  if (materialId) next.floorMaterial = materialId;
  else delete next.floorMaterial;
  return { ok: true, plan: { ...plan, rooms: plan.rooms.map((r) => (r.id === roomId ? next : r)) }, summary: materialId ? `${room.name} floor finished in ${lib.material(materialId)!.name.toLowerCase()}` : `${room.name} floor finish removed` };
}

/** How many items on the plan use a blueprint, directly or through one that nests it. */
export function usesOf(plan: Plan, lib: Resolver, blueprintId: string): number {
  let n = 0;
  const contains = (id: string, seen = new Set<string>()): boolean => {
    if (id === blueprintId) return true;
    if (seen.has(id)) return false;
    seen.add(id);
    return (lib.blueprint(id)?.parts ?? []).some((p) => p.blueprintId && contains(p.blueprintId, seen));
  };
  for (const item of plan.items) if (contains(blueprintFor(lib, item).id)) n += 1;
  for (const wall of plan.walls) if (wall.typeId === blueprintId) n += 1;
  return n;
}

// ---------------------------------------------------------------------------
// Cameras
// ---------------------------------------------------------------------------

export function addCamera(plan: Plan, camera: Omit<PlanCamera, "id" | "name"> & { name?: string }): EditResult {
  const cameras = plan.cameras ?? [];
  if (cameras.length >= 100) return fail("A plan can keep up to 100 cameras.");
  if (!plan.levels.some((l) => l.id === camera.levelId)) return fail("Choose a floor of the plan.");
  const name = camera.name?.trim().slice(0, 120) || `Camera ${cameras.length + 1}`;
  const made: PlanCamera = { ...camera, id: newId(), name };
  const problem = cameraProblem(made);
  if (problem) return fail(problem);
  return { ok: true, id: made.id, plan: { ...plan, cameras: [...cameras, made] }, summary: `Camera "${name}" placed` };
}

export function updateCamera(plan: Plan, cameraId: string, patch: Partial<Omit<PlanCamera, "id">>): EditResult {
  const camera = plan.cameras?.find((c) => c.id === cameraId);
  if (!camera) return fail("That camera is no longer on the plan.");
  const next: PlanCamera = { ...camera, ...patch, name: (patch.name ?? camera.name).trim().slice(0, 120) || camera.name };
  const problem = cameraProblem(next);
  if (problem) return fail(problem);
  if (JSON.stringify(next) === JSON.stringify(camera)) return same(plan);
  return { ok: true, plan: { ...plan, cameras: plan.cameras!.map((c) => (c.id === cameraId ? next : c)) }, summary: patch.name && patch.name !== camera.name ? `Camera "${camera.name}" renamed "${next.name}"` : `Camera "${next.name}" moved` };
}

export function removeCamera(plan: Plan, cameraId: string): EditResult {
  const camera = plan.cameras?.find((c) => c.id === cameraId);
  if (!camera) return fail("That camera is no longer on the plan.");
  return { ok: true, plan: { ...plan, cameras: plan.cameras!.filter((c) => c.id !== cameraId) }, summary: `Camera "${camera.name}" removed` };
}

function cameraProblem(c: PlanCamera): string | null {
  const values = [c.eye.x, c.eye.y, c.eye.z, c.target.x, c.target.y, c.target.z];
  if (!values.every((v) => Number.isFinite(v) && Math.abs(v) <= LIMITS.maxCoord)) return "That camera position is off the plan.";
  if (Math.hypot(c.eye.x - c.target.x, c.eye.y - c.target.y, c.eye.z - c.target.z) < 10) return "A camera must look at a point away from itself.";
  if (c.projection === "perspective" && !(c.fov >= 10 && c.fov <= 120)) return "A camera's angle of view is between 10° and 120°.";
  if (c.projection === "orthographic" && !(c.fov >= 100 && c.fov <= LIMITS.maxCoord)) return "That view height is out of range.";
  return null;
}

/** A section plane, checked. */
export function newSlice(axis: Slice["axis"], at: number): Slice {
  return { id: newId(), axis, at: Math.round(at), flip: false, enabled: true };
}

export const VIEW_STYLES: { key: ViewStyle; label: string }[] = [
  { key: "realistic", label: "Realistic" },
  { key: "clay", label: "Gray model" },
  { key: "lines", label: "Lines" },
];

/**
 * A new blueprint made of the furniture picked on the plan, each piece nested
 * where it stands (like making a Revit group or family from a selection), so
 * a desk cluster or a dining set can be saved once and placed again. The
 * blueprint's origin is the middle of what was picked.
 */
export function blueprintFromItems(
  plan: Plan,
  lib: Resolver,
  itemIds: string[],
  name: string,
  category?: BlueprintCategory,
): { ok: true; blueprint: Omit<Blueprint, "id">; at: Point; levelId: string } | { ok: false; error: string } {
  const items = [...new Set(itemIds)].map((id) => plan.items.find((i) => i.id === id)).filter((i): i is Item => !!i);
  if (!items.length) return { ok: false, error: "Pick the furniture to make it from first." };
  if (items.length > 400) return { ok: false, error: "A blueprint holds up to 400 pieces. Pick fewer, or nest smaller blueprints." };
  const levelId = items[0].levelId;
  if (items.some((i) => i.levelId !== levelId)) return { ok: false, error: "Pick furniture on one floor." };
  const title = name.trim().slice(0, 80);
  if (!title) return { ok: false, error: "Give the blueprint a name." };
  // Where each piece really reaches, so the new blueprint is as big as what it holds.
  const box = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, maxZ: 0 };
  for (const it of items) {
    const e = extent(instanceShapes(lib, blueprintFor(lib, it), { w: it.width, d: it.depth, h: itemHeight(lib, it) }));
    const a = (it.rotation * Math.PI) / 180;
    const c = Math.abs(Math.cos(a));
    const n = Math.abs(Math.sin(a));
    const hx = (it.width * c + it.depth * n) / 2;
    const hy = (it.width * n + it.depth * c) / 2;
    box.minX = Math.min(box.minX, it.at.x - hx);
    box.maxX = Math.max(box.maxX, it.at.x + hx);
    box.minY = Math.min(box.minY, it.at.y - hy);
    box.maxY = Math.max(box.maxY, it.at.y + hy);
    box.maxZ = Math.max(box.maxZ, (it.elevation ?? 0) + (e ? e.maxZ : itemHeight(lib, it)));
  }
  const at = { x: Math.round((box.minX + box.maxX) / 2), y: Math.round((box.minY + box.maxY) / 2) };
  const parts: Part[] = items.map((it, n) => {
    const bp = blueprintFor(lib, it);
    return {
      id: `p${n + 1}`,
      name: it.label || bp.name,
      blueprintId: bp.id,
      at: { x: Math.round(it.at.x - at.x), y: Math.round(it.at.y - at.y), z: Math.round(it.elevation ?? 0) },
      size: { w: it.width, d: it.depth, h: itemHeight(lib, it) },
      rotation: it.rotation,
      ...(it.material ? { material: it.material } : {}),
    };
  });
  const categories = items.map((i) => blueprintFor(lib, i).category);
  const common = categories.every((c) => c === categories[0]) ? categories[0] : "Other";
  return {
    ok: true,
    at,
    levelId,
    blueprint: {
      name: title,
      kind: "object",
      category: category ?? common,
      type: "box",
      size: { w: Math.max(1, Math.round(box.maxX - box.minX)), d: Math.max(1, Math.round(box.maxY - box.minY)), h: Math.max(1, Math.round(box.maxZ)) },
      parts,
      symbol: "parts",
      description: `Made from ${items.length} piece${items.length === 1 ? "" : "s"} on a plan.`,
      revision: 1,
    },
  };
}

/** Swaps the furniture a blueprint was made from for one instance of it, in the same place. */
export function swapForBlueprint(plan: Plan, itemIds: string[], blueprint: Blueprint, at: Point, levelId: string): EditResult {
  const gone = new Set(itemIds);
  if (!plan.items.some((i) => gone.has(i.id))) return fail("That furniture is no longer on the plan.");
  const item: Item = { id: newId(), levelId, type: "box", at, width: blueprint.size.w, depth: blueprint.size.d, rotation: 0, blueprintId: blueprint.id };
  return {
    ok: true,
    plan: { ...plan, items: [...plan.items.filter((i) => !gone.has(i.id)), item] },
    summary: `${gone.size} pieces made into ${blueprint.name}`,
    id: item.id,
    created: [{ kind: "item", id: item.id }],
  };
}
