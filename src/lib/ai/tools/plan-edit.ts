import { setPhase } from "@/lib/plan/phases";
import { openingMarks, setMark } from "@/lib/plan/marks";
import { ceilingHeight, setCeiling } from "@/lib/plan/ceilings";
import { setRoomWalls } from "@/lib/plan/finishes";
import { z } from "zod";
import type { Db } from "@/lib/db";
import {
  addColumn,
  addOpening,
  addRoom,
  addWall,
  DEFAULTS,
  emptyPlan,
  removeItem,
  setWallLength,
  setWallThickness,
  updateColumn,
  updateOpening,
  updateRoom,
  wallLength,
  type EditResult,
  type Plan,
  type PlanItem,
} from "@/lib/plan/geometry";
import {
  addDimension,
  addItem,
  addLevel,
  addNote,
  duplicate,
  moveBy,
  roomAt,
  rotateItem,
  sortedLevels,
  updateItem,
  updateLevel,
  updateNote,
  updateWall,
} from "@/lib/plan/elements";
import { LIBRARY, libraryItem } from "@/lib/plan/library";
import { getPlanState, PlanConflictError, savePlan } from "@/lib/plan/store";
import { MutationError } from "@/lib/projects/store";
import { registerTool, type PlanEdit, type ToolContext } from "./registry";
import { STANDARD, resolver, blueprintFor, type Resolver } from "@/lib/blueprints/resolve";
import { createEntry, listLibrary } from "@/lib/blueprints/store";
import { alignMany, arrayMany, distributeMany, mirrorMany } from "@/lib/plan/selection";
import { pinMany, pinViolation } from "@/lib/plan/pins";
import { offsetWall, splitWall, trimToCorner } from "@/lib/plan/wall-tools";
import { schedule, scheduleText } from "@/lib/plan/schedules";
import { BLUEPRINT_CATEGORIES, type Blueprint } from "@/lib/blueprints/types";
import { addCamera, blueprintFromItems, placeBlueprint, swapForBlueprint, removeCamera, setItemBlueprint, setItemLook, setRoomFloor, setWallType, updateCamera } from "@/lib/blueprints/plan-edits";
import { findBlueprint, findMaterial, mayChange } from "./library";

/**
 * Drawing on the floor plan (the plan editor module's actions for the
 * assistant). The assistant reads the plan with ids and coordinates, then
 * draws, moves, copies and removes things with the same edits the editor
 * makes. Each call is saved at once as one step with a line per change in the
 * plan's corrections log; an open editor draws it as it lands, and Undo in the
 * chat (or Ctrl+Z in the editor) takes it back.
 */

const xy = (p: { x: number; y: number }) => `(${Math.round(p.x)}, ${Math.round(p.y)})`;

/** The plan with every element's id and position, for the model to point at. */
export function detailPlan(plan: Plan, levelId?: string, lib: Resolver = STANDARD): string {
  const levels = sortedLevels(plan).filter((l) => !levelId || l.id === levelId);
  const marks = openingMarks(plan);
  const lines = [
    "Units are millimetres; x runs right and y runs up. Ids are in square brackets.",
    `Floors: ${sortedLevels(plan).map((l) => `${l.name} [level ${l.id}]`).join(", ")}.`,
  ];
  for (const level of levels) {
    const on = <T extends { levelId?: string }>(list: T[]) => list.filter((x) => x.levelId === level.id);
    const walls = on(plan.walls);
    lines.push("", `${level.name} [level ${level.id}], ${level.height} mm floor to ceiling:`);
    if (!walls.length && !on(plan.items).length && !on(plan.rooms).length) lines.push("- Nothing drawn yet.");
    for (const w of walls) {
      const openings = plan.openings.filter((o) => o.wallId === w.id);
      lines.push(
        `- ${w.kind} [wall ${w.id}] ${xy(w.a)} to ${xy(w.b)}, ${Math.round(wallLength(w))} long, ${w.thickness} thick${w.typeId ? `, type ${lib.blueprint(w.typeId)?.name ?? "removed"} [${w.typeId}]` : ""}${w.pinned ? ", pinned" : ""}${w.phase ? `, ${w.phase}` : ""}` +
          (openings.length
            ? `; ${openings.map((o) => `${o.kind} ${marks.get(o.id)}${o.mark ? " (typed)" : ""}${o.style ? ` (${o.style})` : ""} [opening ${o.id}] ${o.width} wide centred ${Math.round(o.at)} from its start${o.phase ? `, ${o.phase}` : ""}`).join("; ")}`
            : "")
      );
    }
    for (const c of on(plan.columns)) lines.push(`- column [column ${c.id}] at ${xy(c.at)}, ${c.width} × ${c.depth}${c.round ? " round" : ""}${c.pinned ? ", pinned" : ""}${c.phase ? `, ${c.phase}` : ""}`);
    for (const r of on(plan.rooms)) lines.push(`- room "${r.name}" [room ${r.id}] corners ${r.points.map(xy).join(" ")}${r.usable ? "" : " (not usable)"}${r.floorMaterial ? `, floor ${lib.material(r.floorMaterial)?.name ?? "removed"} [${r.floorMaterial}]` : ""}${r.wallMaterial ? `, walls ${lib.material(r.wallMaterial)?.name ?? "removed"} [${r.wallMaterial}]` : ""}${r.ceiling || r.ceilingHeight ? `, ceiling ${r.ceiling ?? "plaster"} at ${ceilingHeight(plan, r)}` : ""}${r.pinned ? ", pinned" : ""}`);
    for (const it of on(plan.items)) {
      lines.push(
        `- ${it.blueprintId ? blueprintFor(lib, it).name : libraryItem(it.type).name} [item ${it.id}] type ${it.type}${it.blueprintId ? ` blueprint [${it.blueprintId}]` : ""} at ${xy(it.at)}, ${it.width} × ${it.depth}${it.height ? ` × ${it.height} high` : ""}${it.elevation ? `, lifted ${it.elevation}` : ""}, turned ${it.rotation}°${it.material ? `, in ${lib.material(it.material)?.name ?? it.material}` : ""}${it.label ? `, "${it.label}"` : ""}${it.pinned ? ", pinned" : ""}${it.phase ? `, ${it.phase}` : ""}`
      );
    }
    for (const n of on(plan.notes)) lines.push(`- note [note ${n.id}] "${n.text}" at ${xy(n.at)}`);
    for (const d of on(plan.dimensions)) lines.push(`- dimension [dimension ${d.id}] ${xy(d.a)} to ${xy(d.b)}`);
    for (const c of (plan.cameras ?? []).filter((c) => c.levelId === level.id))
      lines.push(`- camera "${c.name}" [camera ${c.id}] eye (${Math.round(c.eye.x)}, ${Math.round(c.eye.y)}, ${Math.round(c.eye.z)} above the floor) looking at (${Math.round(c.target.x)}, ${Math.round(c.target.y)}, ${Math.round(c.target.z)}), ${c.projection}`);
  }
  return lines.join("\n");
}

const point = z.object({ x: z.number(), y: z.number() });
/** An element's id, or the `ref` an earlier operation in the same call gave what it made. */
const id = z.string().min(1).max(100);
const target = z.object({ kind: z.enum(["wall", "opening", "column", "room", "item", "note", "dimension"]), id });
const ref = z.string().min(1).max(40).optional().describe("A name for what this makes, so later operations in this call can use it as an id.");

const operation = z.discriminatedUnion("op", [
  z.object({ op: z.literal("wall"), from: point, to: point, thickness: z.number().optional(), partition: z.boolean().optional(), ref }),
  z.object({
    op: z.literal("box"),
    corner: point.describe("Bottom-left inside corner."),
    width: z.number().positive(),
    depth: z.number().positive(),
    name: z.string().max(120).optional().describe("Names the room inside; leave out for walls only."),
    partition: z.boolean().optional(),
    thickness: z.number().optional(),
    ref,
  }),
  z.object({
    op: z.literal("opening"),
    wallId: id,
    kind: z.enum(["door", "window"]),
    at: z.number().optional().describe("Distance from the wall's start to the opening's middle; the middle of the wall when left out."),
    width: z.number().optional(),
    style: z.enum(["single", "double", "sliding", "opening"]).optional(),
    ref,
  }),
  z.object({ op: z.literal("column"), at: point, width: z.number().optional(), depth: z.number().optional(), round: z.boolean().optional(), ref }),
  z.object({ op: z.literal("room"), points: z.array(point).min(3).max(200), name: z.string().max(120).optional(), ref }),
  z.object({ op: z.literal("room_at"), inside: point.describe("A point inside closed walls."), name: z.string().max(120).optional(), ref }),
  z.object({
    op: z.literal("item"),
    type: z.string().max(60),
    at: point.describe("The item's middle."),
    rotation: z.number().optional(),
    width: z.number().optional(),
    depth: z.number().optional(),
    label: z.string().max(120).optional(),
    ref,
  }),
  z.object({
    op: z.literal("place"),
    blueprint: z.string().min(1).max(120).describe("A blueprint's id or name from read_library."),
    at: point.describe("Its middle."),
    rotation: z.number().optional(),
    width: z.number().optional(),
    depth: z.number().optional(),
    height: z.number().optional(),
    elevation: z.number().optional().describe("Lift off the floor, mm (wall cabinets, pendants)."),
    material: z.string().max(120).optional().describe("Paints the whole item in one material."),
    label: z.string().max(120).optional(),
    ref,
  }),
  z.object({ op: z.literal("note"), at: point, text: z.string().min(1).max(500), ref }),
  z.object({ op: z.literal("dimension"), from: point, to: point }),
  z.object({ op: z.literal("move"), target, by: point }),
  z.object({ op: z.literal("rotate"), target, degrees: z.number() }),
  z.object({ op: z.literal("copy"), target, offset: point, ref }),
  z.object({ op: z.literal("split_wall"), wallId: id, at: point.describe("A point on the wall where it is cut in two."), ref }),
  z.object({ op: z.literal("trim_walls"), wallA: id, wallB: id, keepA: point.optional().describe("A point on the part of wallA to keep, when they cross."), keepB: point.optional() }),
  z.object({ op: z.literal("offset_wall"), wallId: id, by: z.number().describe("mm to the wall's left going start to end; negative goes right."), ref }),
  z.object({ op: z.literal("pin"), targets: z.array(target).min(1).max(500), pinned: z.boolean().describe("true pins (nothing can move or remove it), false unpins.") }),
  z.object({
    op: z.literal("ceiling"),
    roomId: id,
    kind: z.enum(["plaster", "grid-600", "grid-1200", "slats", "open"]).optional(),
    height: z.number().nullable().optional().describe("Ceiling height above the floor in mm; null goes back to the floor's floor-to-ceiling height."),
  }),
  z.object({ op: z.literal("mark"), openingId: id, mark: z.string().max(12).describe("The door's or window's mark, e.g. D12; empty goes back to automatic numbering.") }),
  z.object({ op: z.literal("phase"), targets: z.array(target).min(1).max(2_000), phase: z.enum(["existing", "demolished", "new"]).describe("existing: there already and staying; demolished: comes out (a wall takes its doors and windows); new: new work.") }),
  z.object({ op: z.literal("mirror"), targets: z.array(target).min(1).max(500), axis: z.enum(["left-right", "up-down"]).describe("left-right flips across a vertical line through the middle of what is picked.") }),
  z.object({ op: z.literal("align"), targets: z.array(target).min(2).max(500), edge: z.enum(["left", "centre", "right", "top", "middle", "bottom"]) }),
  z.object({ op: z.literal("distribute"), targets: z.array(target).min(3).max(500), axis: z.enum(["across", "up"]) }),
  z.object({
    op: z.literal("array"),
    targets: z.array(target).min(1).max(200),
    count: z.number().int().min(2).max(100).describe("How many in the row, the original included."),
    offset: point.optional().describe("From one copy to the next, in mm. Leave out to set them side by side along axis."),
    axis: z.enum(["across", "up"]).optional(),
    gap: z.number().optional().describe("With axis: the space between copies, in mm."),
  }),
  z.object({ op: z.literal("remove"), target }),
  z.object({ op: z.literal("set_wall"), wallId: id, length: z.number().optional(), thickness: z.number().optional(), partition: z.boolean().optional() }),
  z.object({
    op: z.literal("set_opening"),
    openingId: id,
    width: z.number().optional(),
    at: z.number().optional(),
    kind: z.enum(["door", "window"]).optional(),
    style: z.enum(["single", "double", "sliding", "opening"]).optional(),
  }),
  z.object({ op: z.literal("set_column"), columnId: id, width: z.number().optional(), depth: z.number().optional(), round: z.boolean().optional() }),
  z.object({ op: z.literal("set_room"), roomId: id, name: z.string().max(120).optional(), usable: z.boolean().optional() }),
  z.object({
    op: z.literal("set_item"),
    itemId: id,
    width: z.number().optional(),
    depth: z.number().optional(),
    rotation: z.number().optional(),
    label: z.string().max(120).optional(),
    blueprint: z.string().max(120).optional().describe("Swaps it for this blueprint (id or name), keeping its place."),
    keepSize: z.boolean().optional().describe("With blueprint: keep its footprint instead of the blueprint's size."),
    height: z.number().nullable().optional().describe("mm; null goes back to its blueprint's height."),
    elevation: z.number().nullable().optional(),
    material: z.string().max(120).nullable().optional().describe("A material over the whole item; null removes it."),
  }),
  z.object({ op: z.literal("set_note"), noteId: id, text: z.string().min(1).max(500) }),
  z.object({ op: z.literal("wall_type"), wallId: id, type: z.string().max(120).nullable().describe("A wall type's id or name; null for a plain wall. Its thickness becomes the type's.") }),
  z.object({ op: z.literal("room_floor"), roomId: id, material: z.string().max(120).nullable() }),
  z.object({ op: z.literal("room_walls"), roomId: id, material: z.string().max(120).nullable().describe("A material for the faces of the walls round the room, up to its ceiling; null removes it.") }),
  z.object({
    op: z.literal("camera"),
    name: z.string().min(1).max(120),
    eye: z.object({ x: z.number(), y: z.number(), z: z.number().describe("Height above this floor, mm; eye level is about 1,600.") }),
    target: z.object({ x: z.number(), y: z.number(), z: z.number() }),
    fov: z.number().optional().describe("Perspective angle of view in degrees (default 50); for orthographic, the view's height in mm."),
    projection: z.enum(["perspective", "orthographic"]).optional(),
    style: z.enum(["realistic", "clay", "lines"]).optional(),
    ref,
  }),
  z.object({
    op: z.literal("set_camera"),
    cameraId: id,
    name: z.string().max(120).optional(),
    eye: z.object({ x: z.number(), y: z.number(), z: z.number() }).optional(),
    target: z.object({ x: z.number(), y: z.number(), z: z.number() }).optional(),
    fov: z.number().optional(),
    projection: z.enum(["perspective", "orthographic"]).optional(),
  }),
  z.object({ op: z.literal("remove_camera"), cameraId: id }),
  z.object({ op: z.literal("floor"), name: z.string().max(120).optional(), height: z.number().optional(), ref }),
]);

export type PlanOperation = z.infer<typeof operation>;

const ok = (r: EditResult): r is Extract<EditResult, { ok: true }> => r.ok;

/**
 * Applies operations in order to a plan, on one floor. All or nothing: the
 * first that fails stops the lot and says which and why.
 */
export function applyOperations(
  start: Plan,
  levelId: string,
  ops: PlanOperation[],
  lib: Resolver = STANDARD
): { ok: true; plan: Plan; changes: string[]; made: Record<string, string> } | { ok: false; error: string } {
  let plan = start;
  const changes: string[] = [];
  const made: Record<string, string> = {};
  const real = (value: string) => made[value] ?? value;
  const realTarget = (t: PlanItem): PlanItem => ({ kind: t.kind, id: real(t.id) });

  for (const [i, op] of ops.entries()) {
    const steps: EditResult[] = [];
    const step = (r: EditResult) => {
      steps.push(r);
      if (r.ok) {
        plan = r.plan;
        if (r.summary) changes.push(r.summary);
      }
      return r;
    };
    const name = (r: EditResult, key?: string) => {
      if (key && r.ok && r.id) made[key] = r.id;
    };
    switch (op.op) {
      case "wall":
        name(
          step(addWall(plan, op.from, op.to, op.thickness ?? (op.partition ? DEFAULTS.partitionThickness : DEFAULTS.wallThickness), levelId, op.partition ? "partition" : "wall")),
          op.ref
        );
        break;
      case "box": {
        const { x, y } = op.corner;
        const corners = [
          { x, y },
          { x: x + op.width, y },
          { x: x + op.width, y: y + op.depth },
          { x, y: y + op.depth },
        ];
        const thickness = op.thickness ?? (op.partition ? DEFAULTS.partitionThickness : DEFAULTS.wallThickness);
        corners.forEach((a, k) => {
          if (steps.some((s) => !s.ok)) return;
          const r = step(addWall(plan, a, corners[(k + 1) % 4], thickness, levelId, op.partition ? "partition" : "wall"));
          if (op.ref && r.ok && r.id) made[`${op.ref}.${["bottom", "right", "top", "left"][k]}`] = r.id;
        });
        if (op.name && steps.every((s) => s.ok)) name(step(addRoom(plan, corners, op.name, levelId)), op.ref);
        break;
      }
      case "opening": {
        const wall = plan.walls.find((w) => w.id === real(op.wallId));
        const at = op.at ?? (wall ? wallLength(wall) / 2 : 0);
        const r = step(addOpening(plan, real(op.wallId), op.kind, at, op.width ?? DEFAULTS[op.kind]));
        if (r.ok && op.style && r.id) step(updateOpening(plan, r.id, { style: op.style }));
        name(r, op.ref);
        break;
      }
      case "column": {
        const r = step(addColumn(plan, op.at, op.width ?? DEFAULTS.column, op.depth ?? op.width ?? DEFAULTS.column, levelId));
        if (r.ok && op.round && r.id) step(updateColumn(plan, r.id, { round: true }));
        name(r, op.ref);
        break;
      }
      case "room":
        name(step(addRoom(plan, op.points, op.name, levelId)), op.ref);
        break;
      case "room_at":
        name(step(roomAt(plan, op.inside, levelId, op.name)), op.ref);
        break;
      case "item": {
        if (!LIBRARY.some((l) => l.type === op.type)) {
          steps.push({ ok: false, error: `There is no furniture type "${op.type}". Types: ${LIBRARY.map((l) => l.type).join(", ")}.` });
          break;
        }
        const r = step(addItem(plan, op.type, op.at, levelId, op.rotation ?? 0));
        if (r.ok && r.id && (op.width || op.depth || op.label)) {
          step(updateItem(plan, r.id, { ...(op.width ? { width: op.width } : {}), ...(op.depth ? { depth: op.depth } : {}), ...(op.label ? { label: op.label } : {}) }));
        }
        name(r, op.ref);
        break;
      }
      case "note":
        name(step(addNote(plan, op.at, op.text, levelId)), op.ref);
        break;
      case "place": {
        const bp = findBlueprint(lib, op.blueprint);
        if (!bp) {
          steps.push({ ok: false, error: `There is no blueprint "${op.blueprint}". read_library lists them.` });
          break;
        }
        const r = step(placeBlueprint(plan, lib, bp.id, op.at, levelId, op.rotation ?? 0));
        if (r.ok && r.id && (op.width || op.depth || op.label)) step(updateItem(plan, r.id, { ...(op.width ? { width: op.width } : {}), ...(op.depth ? { depth: op.depth } : {}), ...(op.label ? { label: op.label } : {}) }));
        if (r.ok && r.id && (op.height || op.elevation || op.material)) {
          const m = op.material ? findMaterial(lib, op.material) : undefined;
          if (op.material && !m) steps.push({ ok: false, error: `There is no material "${op.material}".` });
          else step(setItemLook(plan, lib, r.id, { ...(op.height ? { height: op.height } : {}), ...(op.elevation ? { elevation: op.elevation } : {}), ...(m ? { material: m.id } : {}) }));
        }
        name(r, op.ref);
        break;
      }
      case "wall_type": {
        const type = op.type === null ? null : findBlueprint(lib, op.type);
        if (op.type !== null && !type) steps.push({ ok: false, error: `There is no wall type "${op.type}".` });
        else step(setWallType(plan, lib, real(op.wallId), type ? type.id : null));
        break;
      }
      case "room_walls": {
        const m = op.material === null ? null : findMaterial(lib, op.material);
        if (op.material !== null && !m) steps.push({ ok: false, error: `There is no material "${op.material}".` });
        else step(setRoomWalls(plan, lib, real(op.roomId), m ? m.id : null));
        break;
      }
      case "room_floor": {
        const m = op.material === null ? null : findMaterial(lib, op.material);
        if (op.material !== null && !m) steps.push({ ok: false, error: `There is no material "${op.material}".` });
        else step(setRoomFloor(plan, lib, real(op.roomId), m ? m.id : null));
        break;
      }
      case "camera": {
        const projection = op.projection ?? "perspective";
        name(step(addCamera(plan, { name: op.name, levelId, eye: op.eye, target: op.target, fov: op.fov ?? (projection === "perspective" ? 50 : 6_000), projection, ...(op.style ? { style: op.style } : {}) })), op.ref);
        break;
      }
      case "set_camera": {
        const { op: _o, cameraId, ...patch } = op;
        void _o;
        step(updateCamera(plan, real(cameraId), patch));
        break;
      }
      case "remove_camera":
        step(removeCamera(plan, real(op.cameraId)));
        break;
      case "dimension":
        step(addDimension(plan, op.from, op.to, levelId));
        break;
      case "move":
        step(moveBy(plan, realTarget(op.target), op.by));
        break;
      case "rotate":
        step(rotateItem(plan, realTarget(op.target), op.degrees));
        break;
      case "copy":
        name(step(duplicate(plan, realTarget(op.target), op.offset)), op.ref);
        break;
      case "split_wall":
        name(step(splitWall(plan, real(op.wallId), op.at)), op.ref);
        break;
      case "trim_walls":
        step(trimToCorner(plan, real(op.wallA), real(op.wallB), op.keepA, op.keepB));
        break;
      case "offset_wall":
        name(step(offsetWall(plan, real(op.wallId), op.by)), op.ref);
        break;
      case "pin":
        step(pinMany(plan, op.targets.map(realTarget), op.pinned));
        break;
      case "ceiling":
        step(setCeiling(plan, real(op.roomId), { kind: op.kind, height: op.height }));
        break;
      case "mark":
        step(setMark(plan, real(op.openingId), op.mark));
        break;
      case "phase":
        step(setPhase(plan, op.targets.map(realTarget), op.phase));
        break;
      case "mirror":
        step(mirrorMany(plan, op.targets.map(realTarget), op.axis));
        break;
      case "align":
        step(alignMany(plan, op.targets.map(realTarget), op.edge));
        break;
      case "distribute":
        step(distributeMany(plan, op.targets.map(realTarget), op.axis));
        break;
      case "array":
        step(arrayMany(plan, op.targets.map(realTarget), op.count, op.offset ?? { axis: op.axis ?? "across", gap: op.gap }));
        break;
      case "remove":
        step(removeItem(plan, realTarget(op.target)));
        break;
      case "set_wall": {
        const wallId = real(op.wallId);
        if (op.length != null) step(setWallLength(plan, wallId, op.length));
        if (op.thickness != null && steps.every((s) => s.ok)) step(setWallThickness(plan, wallId, op.thickness));
        if (op.partition != null && steps.every((s) => s.ok)) step(updateWall(plan, wallId, { kind: op.partition ? "partition" : "wall" }));
        break;
      }
      case "set_opening": {
        const { op: _o, openingId, ...patch } = op;
        void _o;
        step(updateOpening(plan, real(openingId), patch));
        break;
      }
      case "set_column": {
        const { op: _o, columnId, ...patch } = op;
        void _o;
        step(updateColumn(plan, real(columnId), patch));
        break;
      }
      case "set_room": {
        const { op: _o, roomId, ...patch } = op;
        void _o;
        step(updateRoom(plan, real(roomId), patch));
        break;
      }
      case "set_item": {
        const { op: _o, itemId, blueprint, keepSize, height, elevation, material, ...patch } = op;
        void _o;
        const target = real(itemId);
        if (blueprint) {
          const bp = findBlueprint(lib, blueprint);
          if (!bp) {
            steps.push({ ok: false, error: `There is no blueprint "${blueprint}".` });
            break;
          }
          step(setItemBlueprint(plan, lib, target, bp.id, !keepSize));
        }
        if (Object.values(patch).some((v) => v !== undefined) && !steps.some((s) => !s.ok)) step(updateItem(plan, target, patch));
        if ((height !== undefined || elevation !== undefined || material !== undefined) && !steps.some((s) => !s.ok)) {
          const m = material ? findMaterial(lib, material) : null;
          if (material && !m) steps.push({ ok: false, error: `There is no material "${material}".` });
          else step(setItemLook(plan, lib, target, { ...(height !== undefined ? { height } : {}), ...(elevation !== undefined ? { elevation } : {}), ...(material !== undefined ? { material: m ? m.id : null } : {}) }));
        }
        break;
      }
      case "set_note":
        step(updateNote(plan, real(op.noteId), op.text));
        break;
      case "floor": {
        const r = step(addLevel(plan, op.name));
        if (r.ok && r.id && op.height) step(updateLevel(plan, r.id, { height: op.height }));
        name(r, op.ref);
        break;
      }
    }
    const failed = steps.find((s) => !s.ok);
    if (failed && !ok(failed)) return { ok: false, error: `Operation ${i + 1} (${op.op}) failed: ${failed.error} Nothing was changed.` };
    if (!steps.length) return { ok: false, error: `Operation ${i + 1} (${op.op}) did nothing. Nothing was changed.` };
  }
  return { ok: true, plan, changes, made };
}

/** Saves a plan the assistant changed, retrying once if someone saved in between. */
async function saveEdit(
  ctx: ToolContext,
  apply: (plan: Plan) => ReturnType<typeof applyOperations>
): Promise<{ error: string } | { edit: PlanEdit; made: Record<string, string> }> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const state = await getPlanState(ctx.db, ctx.run.workspaceId, ctx.project.id);
    if (!state) return { error: "Project not found." };
    const before = state.plan;
    const result = apply(before ?? emptyPlan());
    if (!result.ok) return { error: result.error };
    const pinned = before ? pinViolation(before, result.plan) : null;
    if (pinned) return { error: `${pinned} Ask her before unpinning anything.` };
    if (!result.changes.length) return { error: "That changed nothing on the plan." };
    try {
      const { revision } = await savePlan(ctx.db, ctx.run.workspaceId, ctx.run.userId, ctx.project.id, {
        plan: result.plan,
        baseRevision: state.revision || null,
        changes: result.changes.map((c) => `Fundur: ${c}`),
      });
      return { edit: { before, plan: result.plan, revision, changes: result.changes }, made: result.made };
    } catch (err) {
      if (!(err instanceof PlanConflictError) || attempt) throw err;
    }
  }
  return { error: "The plan kept changing while I drew. Try again." };
}

const furniture = LIBRARY.map((l) => `${l.type} (${l.width}×${l.depth})`).join(", ");

registerTool({
  name: "read_plan_detail",
  module: "floor_plan_editor",
  label: "Reading the plan in detail",
  description:
    "Reads the floor plan with every wall, opening, column, room, piece of furniture, note and dimension, each with its id and position in millimetres. Read it before editing the plan, and again after, to check the result.",
  input: z.object({ floor: z.string().max(120).optional().describe("A floor's name or id; every floor when left out.") }),
  async run(ctx, input) {
    const state = await getPlanState(ctx.db, ctx.run.workspaceId, ctx.project.id);
    if (!state?.plan) return { content: "No floor plan yet. edit_plan draws one from nothing." };
    const level = input.floor
      ? state.plan.levels.find((l) => l.id === input.floor || l.name.toLowerCase() === input.floor!.trim().toLowerCase())
      : undefined;
    if (input.floor && !level) return { content: `There is no floor "${input.floor}". Floors: ${state.plan.levels.map((l) => l.name).join(", ")}.` };
    return { content: detailPlan(state.plan, level?.id, resolver(await listLibrary(ctx.db, ctx.run.workspaceId))) };
  },
});

registerTool({
  name: "edit_plan",
  module: "floor_plan_editor",
  label: "Drawing on the plan",
  description:
    "Draws on and edits the floor plan, live in front of the designer: walls, partitions, rectangular rooms with their walls (box), doors and windows on walls, columns, rooms, furniture, notes and dimensions; and moves, turns, copies, resizes, renames or removes what is there. " +
    "Millimetres, x right, y up. Operations run in order on one floor and all succeed or none do; give what you make a ref to use it as an id later in the same call (a box's walls are ref.bottom, ref.right, ref.top and ref.left; bottom runs left to right, so a door on it is measured from its left end). " +
    "mirror, align, distribute and array (Revit's Array: a row of copies) work on many targets at once; pin stops things being moved or removed (pinned things are marked; leave them where they are); split_wall, trim_walls (trim or extend two walls to meet at a corner) and offset_wall (a parallel copy) edit walls as Revit does; phase marks walls, doors, windows, columns and furniture as existing, demolished or new (none listed means new), for fit-out drawings; mark gives a door or window its own mark (others are numbered D01, W01 for her); ceiling sets a room's ceiling (plaster, grid-600, grid-1200, slats, open) and height, for the reflected ceiling plan. " +
    "place puts a blueprint from the design library (read_library) by id or name; set_item swaps an item's blueprint and sets its height, lift and material; wall_type gives a wall a layered type; room_floor finishes a room's floor; room_walls finishes the walls round a room (each face separately, so two rooms can finish one partition differently); camera places a named camera (eye and target in mm, eye height above this floor) for views and renders. " +
    "It is saved at once and she can undo it. Use ids from read_plan_detail or her selection. Furniture types: " +
    furniture +
    ".",
  input: z.object({
    floor: z.string().max(120).optional().describe("A floor's name or id; the floor she is looking at, else the first."),
    operations: z.array(operation).min(1).max(150),
  }),
  async run(ctx, input) {
    const lib = resolver(await listLibrary(ctx.db, ctx.run.workspaceId));
    const out = await saveEdit(ctx, (plan) => {
      const wanted = input.floor?.trim().toLowerCase();
      const level =
        (wanted && plan.levels.find((l) => l.id === input.floor || l.name.toLowerCase() === wanted)) ||
        (!wanted && ctx.context?.levelId && plan.levels.find((l) => l.id === ctx.context!.levelId)) ||
        (!wanted ? plan.levels[0] : undefined);
      if (!level) return { ok: false, error: `There is no floor "${input.floor}". Floors: ${plan.levels.map((l) => l.name).join(", ")}.` };
      return applyOperations(plan, level.id, input.operations, lib);
    });
    if ("error" in out) return { content: out.error, isError: true };
    const { edit, made } = out;
    const refs = Object.entries(made);
    return {
      content: [
        `Drawn and saved (${edit.changes.length} change${edit.changes.length === 1 ? "" : "s"}); she sees it now and can undo it.`,
        ...edit.changes.map((c) => `- ${c}`),
        refs.length ? `Ids: ${refs.map(([k, v]) => `${k} = ${v}`).join(", ")}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
      planEdit: edit,
    };
  },
});

registerTool({
  name: "read_schedules",
  module: "floor_plan_editor",
  label: "Counting the plan",
  description:
    "Reads the plan's schedules, counted from the drawing: furniture by blueprint, size and finish; rooms with areas, perimeters and floor finishes; doors and windows by type and size; walls by type with total length and face area. Use it for quantities, FF&E lists and checking a plan.",
  input: z.object({
    kinds: z.array(z.enum(["furniture", "rooms", "openings", "walls"])).min(1).max(4).optional().describe("Every schedule when left out."),
    floor: z.string().max(120).optional().describe("A floor's name or id; every floor when left out."),
  }),
  async run(ctx, input) {
    const state = await getPlanState(ctx.db, ctx.run.workspaceId, ctx.project.id);
    if (!state?.plan) return { content: "No floor plan yet." };
    const wanted = input.floor?.trim().toLowerCase();
    const level = wanted ? state.plan.levels.find((l) => l.id === input.floor || l.name.toLowerCase() === wanted) : undefined;
    if (wanted && !level) return { content: `There is no floor "${input.floor}". Floors: ${state.plan.levels.map((l) => l.name).join(", ")}.` };
    const lib = resolver(await listLibrary(ctx.db, ctx.run.workspaceId));
    const kinds = input.kinds ?? ["furniture", "rooms", "openings", "walls"];
    return { content: kinds.map((k) => scheduleText(schedule(state.plan!, k, lib, level?.id))).join("\n\n") + "\n\nShe can open these under Schedules in the plan editor and download them as CSV." };
  },
});

registerTool({
  name: "blueprint_from_plan",
  module: "floor_plan_editor",
  label: "Making a blueprint from the plan",
  description:
    "Saves furniture on the plan as one new blueprint in the design library, each piece nested where it stands (a desk cluster, a dining set, a bed with side tables), and by default puts one instance of it in their place, so changing the blueprint later changes every copy. Use item ids from read_plan_detail or her selection; all on one floor.",
  input: z.object({
    itemIds: z.array(id).min(1).max(200),
    name: z.string().min(1).max(80),
    category: z.enum(BLUEPRINT_CATEGORIES).optional(),
    keepPieces: z.boolean().optional().describe("Leave the furniture as it is and only save the blueprint."),
  }),
  async run(ctx, input) {
    const denied = await mayChange(ctx);
    if (denied) return { content: denied, isError: true };
    const state = await getPlanState(ctx.db, ctx.run.workspaceId, ctx.project.id);
    if (!state?.plan) return { content: "No floor plan yet.", isError: true };
    const lib = resolver(await listLibrary(ctx.db, ctx.run.workspaceId));
    const made = blueprintFromItems(state.plan, lib, input.itemIds, input.name, input.category);
    if (!made.ok) return { content: made.error, isError: true };
    const saved = (await createEntry(ctx.db, ctx.run.workspaceId, ctx.run.userId, "blueprint", made.blueprint)).entry as Blueprint;
    const summary = `Saved ${saved.name} [${saved.id}] to the design library: ${saved.parts.length} pieces, ${saved.size.w} × ${saved.size.d} × ${saved.size.h} mm.`;
    if (input.keepPieces) return { content: summary, libraryChanged: true };
    const out = await saveEdit(ctx, (plan) => {
      const r = swapForBlueprint(plan, input.itemIds, saved, made.at, made.levelId);
      return r.ok ? { ok: true, plan: r.plan, changes: [r.summary], made: { blueprint: r.id! } } : r;
    });
    if ("error" in out) return { content: `${summary} It was not put on the plan: ${out.error}`, libraryChanged: true, isError: true };
    return { content: `${summary} It now stands in their place as [item ${out.made.blueprint}]; she can undo that.`, planEdit: out.edit, libraryChanged: true };
  },
});

/**
 * Takes back a plan edit the assistant made: the plan goes back to how it was,
 * provided nobody changed it since. Returns the plan state as saved.
 */
export async function undoPlanEdit(
  db: Db,
  workspaceId: string,
  userId: string,
  slug: string,
  edit: { type: "planEdit"; revision: number; changes: string[] },
  undo: unknown
) {
  const before = (undo as { before?: Plan | null } | null)?.before ?? null;
  const state = await getPlanState(db, workspaceId, slug);
  if (!state) throw new MutationError("Project not found");
  if (state.revision !== edit.revision) {
    throw new MutationError("The plan has changed since. Undo it in the plan editor (Ctrl+Z), or go back to a saved version there.");
  }
  try {
    const { revision } = await savePlan(db, workspaceId, userId, slug, {
      plan: before ?? emptyPlan(),
      baseRevision: state.revision,
      changes: [`Undid Fundur's change: ${edit.changes.slice(0, 3).join("; ")}${edit.changes.length > 3 ? "…" : ""}`],
    });
    return { plan: before ?? emptyPlan(), revision };
  } catch (err) {
    if (err instanceof PlanConflictError) throw new MutationError("The plan changed while undoing. Try again.");
    throw err;
  }
}
