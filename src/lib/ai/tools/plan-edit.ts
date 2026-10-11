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
export function detailPlan(plan: Plan, levelId?: string): string {
  const levels = sortedLevels(plan).filter((l) => !levelId || l.id === levelId);
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
        `- ${w.kind} [wall ${w.id}] ${xy(w.a)} to ${xy(w.b)}, ${Math.round(wallLength(w))} long, ${w.thickness} thick` +
          (openings.length
            ? `; ${openings.map((o) => `${o.kind}${o.style ? ` (${o.style})` : ""} [opening ${o.id}] ${o.width} wide centred ${Math.round(o.at)} from its start`).join("; ")}`
            : "")
      );
    }
    for (const c of on(plan.columns)) lines.push(`- column [column ${c.id}] at ${xy(c.at)}, ${c.width} × ${c.depth}${c.round ? " round" : ""}`);
    for (const r of on(plan.rooms)) lines.push(`- room "${r.name}" [room ${r.id}] corners ${r.points.map(xy).join(" ")}${r.usable ? "" : " (not usable)"}`);
    for (const it of on(plan.items)) {
      lines.push(
        `- ${libraryItem(it.type).name} [item ${it.id}] type ${it.type} at ${xy(it.at)}, ${it.width} × ${it.depth}, turned ${it.rotation}°${it.label ? `, "${it.label}"` : ""}`
      );
    }
    for (const n of on(plan.notes)) lines.push(`- note [note ${n.id}] "${n.text}" at ${xy(n.at)}`);
    for (const d of on(plan.dimensions)) lines.push(`- dimension [dimension ${d.id}] ${xy(d.a)} to ${xy(d.b)}`);
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
  z.object({ op: z.literal("note"), at: point, text: z.string().min(1).max(500), ref }),
  z.object({ op: z.literal("dimension"), from: point, to: point }),
  z.object({ op: z.literal("move"), target, by: point }),
  z.object({ op: z.literal("rotate"), target, degrees: z.number() }),
  z.object({ op: z.literal("copy"), target, offset: point, ref }),
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
  }),
  z.object({ op: z.literal("set_note"), noteId: id, text: z.string().min(1).max(500) }),
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
  ops: PlanOperation[]
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
        const { op: _o, itemId, ...patch } = op;
        void _o;
        step(updateItem(plan, real(itemId), patch));
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
    return { content: detailPlan(state.plan, level?.id) };
  },
});

registerTool({
  name: "edit_plan",
  module: "floor_plan_editor",
  label: "Drawing on the plan",
  description:
    "Draws on and edits the floor plan, live in front of the designer: walls, partitions, rectangular rooms with their walls (box), doors and windows on walls, columns, rooms, furniture, notes and dimensions; and moves, turns, copies, resizes, renames or removes what is there. " +
    "Millimetres, x right, y up. Operations run in order on one floor and all succeed or none do; give what you make a ref to use it as an id later in the same call (a box's walls are ref.bottom, ref.right, ref.top and ref.left; bottom runs left to right, so a door on it is measured from its left end). " +
    "It is saved at once and she can undo it. Use ids from read_plan_detail or her selection. Furniture types: " +
    furniture +
    ".",
  input: z.object({
    floor: z.string().max(120).optional().describe("A floor's name or id; the floor she is looking at, else the first."),
    operations: z.array(operation).min(1).max(150),
  }),
  async run(ctx, input) {
    const out = await saveEdit(ctx, (plan) => {
      const wanted = input.floor?.trim().toLowerCase();
      const level =
        (wanted && plan.levels.find((l) => l.id === input.floor || l.name.toLowerCase() === wanted)) ||
        (!wanted && ctx.context?.levelId && plan.levels.find((l) => l.id === ctx.context!.levelId)) ||
        (!wanted ? plan.levels[0] : undefined);
      if (!level) return { ok: false, error: `There is no floor "${input.floor}". Floors: ${plan.levels.map((l) => l.name).join(", ")}.` };
      return applyOperations(plan, level.id, input.operations);
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
