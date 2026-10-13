import { z } from "zod";
import type { Db } from "@/lib/db";
import type { WorkspaceRole } from "@/lib/auth/permissions";
import { canUseAssemblies } from "@/lib/plan/assembly-store";
import { createEntry, LibraryConflictError, LibraryError, listLibrary, listVersions, updateEntry } from "@/lib/blueprints/store";
import { resolver, usedBy, type Resolver } from "@/lib/blueprints/resolve";
import {
  addShape,
  arrayPart,
  blankBlueprint,
  copyOf,
  duplicatePart,
  fitToParts,
  mirrorPart,
  nestBlueprint,
  problems,
  removePart,
  resizeBlueprint,
  setLayers,
  updateBlueprint,
  updatePart,
  type BlueprintEdit,
} from "@/lib/blueprints/edit";
import { BLUEPRINT_CATEGORIES, MATERIAL_CATEGORIES, isStandard, type Blueprint, type Material } from "@/lib/blueprints/types";
import { blueprintBody, materialBody } from "@/lib/blueprints/schema";
import { bodyOf } from "@/lib/blueprints/body";
import { LIBRARY } from "@/lib/plan/library";
import { importFree, searchFree, TextureSourceError } from "@/lib/textures/free";
import { aiTexture } from "@/lib/textures/ai";
import { registerTool, type ToolContext } from "./registry";

/**
 * The design library for the assistant: it reads the practice's blueprints,
 * wall types and materials, designs and changes blueprints with the same edits
 * the blueprint editor makes (every save is a version that can be restored),
 * and adds materials, including free textures and ones the AI makes. A
 * default cannot be changed, so changing one saves a copy in the library.
 */

const mm = (n: number) => Math.round(n);

async function role(db: Db, workspaceId: string, userId: string): Promise<WorkspaceRole | undefined> {
  const [row] = await db.query<{ role: WorkspaceRole }>("SELECT role FROM memberships WHERE workspace_id = $1 AND user_id = $2", [workspaceId, userId]);
  return row?.role;
}

export async function mayChange(ctx: ToolContext): Promise<string | null> {
  return canUseAssemblies(await role(ctx.db, ctx.run.workspaceId, ctx.run.userId)) ? null : "Only practice owners and members can change the design library.";
}

/** Finds an entry by its id or (ignoring case) its name; the practice's own first. */
export function findBlueprint(lib: Resolver, ref: string): Blueprint | undefined {
  const want = ref.trim().toLowerCase();
  return lib.blueprint(ref) ?? [...lib.blueprints].reverse().find((b) => b.name.toLowerCase() === want) ?? lib.blueprint(`std:${want}`);
}
export function findMaterial(lib: Resolver, ref: string): Material | undefined {
  const want = ref.trim().toLowerCase();
  return lib.material(ref) ?? [...lib.materials].reverse().find((m) => m.name.toLowerCase() === want) ?? lib.material(`std:${want}`);
}

const size3 = (b: { w: number; d: number; h: number }) => `${mm(b.w)} × ${mm(b.d)} × ${mm(b.h)}`;

/** A blueprint's parts and layers, with ids, for the model to edit. */
export function describeBlueprint(lib: Resolver, bp: Blueprint): string {
  const lines = [
    `${bp.name} [blueprint ${bp.id}]${isStandard(bp.id) ? " (default: read-only, changes save as a copy)" : ` revision ${bp.revision}`}`,
    `${bp.kind === "wall" ? "Wall type" : `Counts as ${bp.type}`}, ${bp.category}, ${size3(bp.size)} mm (width × depth × height). Local frame: x across, y to the back (+y is the back), z up; origin at the middle of its footprint on the floor.`,
  ];
  if (bp.description) lines.push(`Notes: ${bp.description}`);
  if (bp.layers) lines.push(`Layers, left face to right: ${bp.layers.map((l) => `${l.name} ${l.thickness} mm in ${lib.material(l.material)?.name ?? l.material}`).join("; ")}.`);
  lines.push(`Parts (${bp.parts.length}):`);
  for (const p of bp.parts) {
    const child = p.blueprintId ? lib.blueprint(p.blueprintId) : undefined;
    const what = child ? `blueprint ${child.name} [${child.id}]` : p.blueprintId ? `missing blueprint ${p.blueprintId}` : p.shape;
    lines.push(
      `- [part ${p.id}] ${p.name ?? ""} ${what} at (${mm(p.at.x)}, ${mm(p.at.y)}, ${mm(p.at.z)}), ${size3(p.size)}${p.rotation ? `, turned ${p.rotation}°` : ""}${p.radius ? `, corners ${p.radius}` : ""}${p.taper != null ? `, top ${Math.round(p.taper * 100)}% of the bottom` : ""}${p.hollow ? `, hollow with a ${p.hollow} mm wall` : ""}${p.tilt ? `, leaning ${p.tilt.x ?? 0}° back and ${p.tilt.y ?? 0}° right` : ""}${p.profile ? `, ${p.shape === "lathe" ? "profile" : "outline"} ${JSON.stringify(p.profile)}` : ""}${p.material ? `, in ${lib.material(p.material)?.name ?? p.material} [${p.material}]` : ""}`.replace(/\s+/g, " ")
    );
  }
  const users = usedBy(lib, bp.id);
  if (users.length) lines.push(`Used inside: ${users.map((u) => u.name).join(", ")}.`);
  const issues = problems(lib, bp);
  if (issues.length) lines.push(`Problems: ${issues.join(" ")}`);
  return lines.join("\n");
}

registerTool({
  name: "read_library",
  anywhere: true,
  module: "floor_plan_editor",
  label: "Reading the design library",
  description:
    "Reads the design library: furniture and object blueprints, wall types and materials, the practice's own and the defaults, with ids. Give a blueprint's id or name to read its parts (with part ids), layers and where it is used, before changing it with edit_blueprint or placing it on the plan.",
  input: z.object({
    blueprint: z.string().max(120).optional().describe("A blueprint's id or name, to read it in detail."),
    search: z.string().max(120).optional().describe("Words to filter by."),
    show: z.enum(["blueprints", "walls", "materials", "all"]).optional(),
  }),
  async run(ctx, input) {
    const lib = resolver(await listLibrary(ctx.db, ctx.run.workspaceId));
    if (input.blueprint) {
      const bp = findBlueprint(lib, input.blueprint);
      return bp ? { content: describeBlueprint(lib, bp) } : { content: `There is no blueprint "${input.blueprint}".`, isError: true };
    }
    const words = (input.search ?? "").toLowerCase().split(/\s+/).filter(Boolean);
    const hit = (text: string) => words.every((w) => text.toLowerCase().includes(w));
    const show = input.show ?? "all";
    const lines: string[] = ["Ids are in brackets; std: ids are defaults (read-only)."];
    if (show === "all" || show === "blueprints") {
      const list = lib.blueprints.filter((b) => b.kind === "object" && hit(`${b.name} ${b.category} ${b.type} ${(b.tags ?? []).join(" ")}`));
      lines.push(`Furniture and objects (${list.length}):`, ...list.slice(0, 200).map((b) => `- ${b.name} [${b.id}] ${b.category}, counts as ${b.type}, ${size3(b.size)}${b.parts.some((p) => p.blueprintId) ? ", built from others" : ""}`));
    }
    if (show === "all" || show === "walls") {
      const list = lib.blueprints.filter((b) => b.kind === "wall" && hit(`${b.name} ${b.category}`));
      lines.push(`Wall types (${list.length}):`, ...list.map((b) => `- ${b.name} [${b.id}] ${mm(b.size.d)} mm: ${(b.layers ?? []).map((l) => `${l.name} ${l.thickness}`).join(", ")}`));
    }
    if (show === "all" || show === "materials") {
      const list = lib.materials.filter((m) => hit(`${m.name} ${m.category}`));
      lines.push(`Materials (${list.length}):`, ...list.slice(0, 200).map((m) => `- ${m.name} [${m.id}] ${m.category}, ${m.color}${m.image ? ", textured" : m.pattern && m.pattern !== "plain" ? `, ${m.pattern} pattern` : ""}${m.source ? `, from ${m.source.name}` : ""}`));
    }
    return { content: lines.join("\n") };
  },
});

const vec = z.object({ x: z.number(), y: z.number(), z: z.number() });
const size = z.object({ w: z.number().positive(), d: z.number().positive(), h: z.number().positive() });
const partRef = z.string().min(1).max(60).describe("A part's id, or the ref an earlier operation gave it.");
const ref = z.string().min(1).max(40).optional().describe("A name for the part this makes, to use as its id later in this call.");
const blueprintOp = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("set"),
    name: z.string().max(120).optional(),
    category: z.enum(BLUEPRINT_CATEGORIES).optional(),
    type: z.string().max(40).optional().describe("The furniture type it counts as for layout rules."),
    symbol: z.enum(["type", "parts"]).optional().describe("2D symbol: the type's standard symbol, or its parts seen from above."),
    description: z.string().max(2_000).optional(),
    tags: z.array(z.string().max(40)).max(20).optional(),
  }),
  z.object({ op: z.literal("resize"), w: z.number().positive().optional(), d: z.number().positive().optional(), h: z.number().positive().optional() }).describe("Stretches every part with it."),
  z.object({ op: z.literal("add_shape"), shape: z.enum(["box", "cylinder", "sphere", "wedge", "lathe", "extrude"]), taper: z.number().min(0).max(4).optional().describe("Top size as a share of the bottom (box, cylinder, extrude): 1 straight, 0 a point."), profile: z.array(z.tuple([z.number().min(0).max(1), z.number().min(0).max(1)])).min(2).max(96).optional().describe("lathe: (radius share of half the width, height share) bottom up; extrude: outline (share across, share back)."), hollow: z.number().min(0).optional().describe("cylinder or lathe: wall and base thickness in mm, open at the top (pots, tubes, shades); 0 makes it solid."), tilt: z.object({ x: z.number().min(-90).max(90).optional(), y: z.number().min(-90).max(90).optional() }).optional().describe("Lean in degrees: x tips the top to the back, y to the right."), at: vec.describe("Middle of its footprint (x, y) and underside (z)."), size, rotation: z.number().optional(), radius: z.number().min(0).optional(), material: z.string().max(120).optional(), name: z.string().max(80).optional(), ref }),
  z.object({ op: z.literal("nest"), blueprint: z.string().max(120).describe("Id or name of the blueprint to put inside; it stays linked."), at: vec, size: size.optional(), rotation: z.number().optional(), material: z.string().max(120).optional(), name: z.string().max(80).optional(), ref }),
  z.object({ op: z.literal("update_part"), part: partRef, shape: z.enum(["box", "cylinder", "sphere", "wedge", "lathe", "extrude"]).optional(), taper: z.number().min(0).max(4).optional().describe("Top size as a share of the bottom (box, cylinder, extrude): 1 straight, 0 a point."), profile: z.array(z.tuple([z.number().min(0).max(1), z.number().min(0).max(1)])).min(2).max(96).optional().describe("lathe: (radius share of half the width, height share) bottom up; extrude: outline (share across, share back)."), hollow: z.number().min(0).optional().describe("cylinder or lathe: wall and base thickness in mm, open at the top (pots, tubes, shades); 0 makes it solid."), tilt: z.object({ x: z.number().min(-90).max(90).optional(), y: z.number().min(-90).max(90).optional() }).optional().describe("Lean in degrees: x tips the top to the back, y to the right."), at: vec.partial().optional(), size: size.partial().optional(), rotation: z.number().optional(), radius: z.number().min(0).optional(), material: z.string().max(120).nullable().optional(), name: z.string().max(80).optional() }),
  z.object({ op: z.literal("remove_part"), part: partRef }),
  z.object({ op: z.literal("duplicate_part"), part: partRef, offset: vec.optional(), ref }),
  z.object({ op: z.literal("mirror_part"), part: partRef, axis: z.enum(["x", "y"]).describe("x mirrors across (left to right), y front to back."), copy: z.boolean().optional() }),
  z.object({ op: z.literal("array_part"), part: partRef, count: z.number().int().min(2).max(50), step: vec }),
  z.object({ op: z.literal("layers"), layers: z.array(z.object({ name: z.string().max(80), thickness: z.number().positive(), material: z.string().max(120) })).min(1).max(20) }).describe("Wall types only, left face to right."),
  z.object({ op: z.literal("fit") }).describe("Sets the size to what the parts take up."),
  z.object({ op: z.literal("restore"), revision: z.number().int().min(1) }).describe("Goes back to an earlier saved version."),
]);

registerTool({
  name: "edit_blueprint",
  anywhere: true,
  module: "floor_plan_editor",
  label: "Designing a blueprint",
  description:
    "Creates or changes a blueprint in the design library: furniture, objects and wall types built from shapes (box, cylinder, sphere, wedge; lathe for turned forms like pots, vases, bowls, lamp bases and legs; extrude for any outline like an L desk, hexagon table or arch; any of them tapered, hollowed or tilted) and other blueprints nested inside (linked, so changing the inner one changes this). " +
    "Millimetres in the blueprint's own frame: x across, y to the back, z up, origin at the middle of its footprint on the floor. Saving changes it on every plan and in every blueprint that uses it, and keeps the old version (restore takes it back). " +
    "A default (std: id) cannot change, so changing one saves a copy in the practice's library and says its new id. Read it with read_library first. Materials are ids or names from read_library.",
  input: z.object({
    blueprint: z.string().max(120).optional().describe("The id or name of the blueprint to change; leave out to create one."),
    create: z
      .object({ name: z.string().min(1).max(120), kind: z.enum(["object", "wall"]).optional(), copyOf: z.string().max(120).optional().describe("Start from this blueprint's id or name.") })
      .optional(),
    operations: z.array(blueprintOp).max(120).default([]),
  }),
  async run(ctx, input) {
    const denied = await mayChange(ctx);
    if (denied) return { content: denied, isError: true };
    for (let attempt = 0; attempt < 2; attempt++) {
      const lib = resolver(await listLibrary(ctx.db, ctx.run.workspaceId));
      let start: Blueprint;
      let isNew = false;
      if (input.blueprint) {
        const found = findBlueprint(lib, input.blueprint);
        if (!found) return { content: `There is no blueprint "${input.blueprint}". read_library lists them.`, isError: true };
        start = found;
        if (isStandard(found.id)) {
          isNew = true;
          start = { ...copyOf(found, input.create?.name ?? found.name), id: "new", revision: 0 } as Blueprint;
        }
      } else if (input.create) {
        isNew = true;
        const source = input.create.copyOf ? findBlueprint(lib, input.create.copyOf) : undefined;
        if (input.create.copyOf && !source) return { content: `There is no blueprint "${input.create.copyOf}" to copy.`, isError: true };
        start = { ...(source ? copyOf(source, input.create.name) : blankBlueprint(input.create.name, input.create.kind ?? "object")), id: "new", revision: 0 } as Blueprint;
        // A new object built from shapes starts empty, not with the placeholder box a person starts from.
        if (!source && (input.create.kind ?? "object") === "object" && input.operations.some((o) => o.op === "add_shape" || o.op === "nest")) start = { ...start, parts: [] };
      } else return { content: "Say which blueprint to change, or give create.", isError: true };

      // Apply the operations to a draft, in order; all or nothing.
      let bp = start;
      const made: Record<string, string> = {};
      const changes: string[] = [];
      const real = (id: string) => made[id] ?? id;
      const mat = (refText: string | null | undefined) => {
        if (refText == null) return refText;
        const m = findMaterial(lib, refText);
        if (!m) throw new LibraryError(`There is no material "${refText}". read_library with show "materials" lists them.`);
        return m.id;
      };
      try {
        for (const [i, op] of input.operations.entries()) {
          let r: BlueprintEdit;
          switch (op.op) {
            case "set": {
              const { op: _op, ...patch } = op;
              void _op;
              r = updateBlueprint(bp, patch);
              if (op.type && !LIBRARY.some((l) => l.type === op.type)) r = { ok: false, error: `There is no type "${op.type}". Types: ${LIBRARY.map((l) => l.type).join(", ")}.` };
              break;
            }
            case "resize":
              r = resizeBlueprint(bp, { w: op.w ?? bp.size.w, d: op.d ?? bp.size.d, h: op.h ?? bp.size.h });
              break;
            case "add_shape":
              r = addShape(bp, op.shape, { at: op.at, size: op.size, rotation: op.rotation ?? 0, ...(op.radius ? { radius: op.radius } : {}), ...(op.taper != null ? { taper: op.taper } : {}), ...(op.profile ? { profile: op.profile } : {}), ...(op.hollow ? { hollow: op.hollow } : {}), ...(op.tilt ? { tilt: op.tilt } : {}), ...(op.material ? { material: mat(op.material)! } : {}), ...(op.name ? { name: op.name } : {}) });
              break;
            case "nest": {
              const child = findBlueprint(lib, op.blueprint);
              if (!child) throw new LibraryError(`There is no blueprint "${op.blueprint}".`);
              r = nestBlueprint(lib, bp, child.id, { at: op.at, ...(op.size ? { size: op.size } : {}), rotation: op.rotation ?? 0, ...(op.material ? { material: mat(op.material)! } : {}), ...(op.name ? { name: op.name } : {}) });
              break;
            }
            case "update_part": {
              const part = bp.parts.find((p) => p.id === real(op.part));
              if (!part) throw new LibraryError(`There is no part "${op.part}".`);
              r = updatePart(lib, bp, part.id, {
                ...(op.at ? { at: { ...part.at, ...op.at } } : {}),
                ...(op.size ? { size: { ...part.size, ...op.size } } : {}),
                ...(op.rotation != null ? { rotation: op.rotation } : {}),
                ...(op.radius != null ? { radius: op.radius || undefined } : {}),
                ...(op.shape ? { shape: op.shape } : {}),
                ...(op.taper != null ? { taper: op.taper } : {}),
                ...(op.profile ? { profile: op.profile } : {}),
                ...(op.hollow != null ? { hollow: op.hollow } : {}),
                ...(op.tilt ? { tilt: op.tilt } : {}),
                ...(op.material !== undefined ? { material: op.material === null ? undefined : mat(op.material)! } : {}),
                ...(op.name ? { name: op.name } : {}),
              });
              break;
            }
            case "remove_part":
              r = removePart(bp, real(op.part));
              break;
            case "duplicate_part":
              r = duplicatePart(bp, real(op.part), op.offset);
              break;
            case "mirror_part":
              r = mirrorPart(bp, real(op.part), op.axis, op.copy ?? true);
              break;
            case "array_part":
              r = arrayPart(bp, real(op.part), op.count, op.step);
              break;
            case "layers":
              r = setLayers(bp, op.layers.map((l) => ({ ...l, material: mat(l.material)! })));
              break;
            case "fit":
              r = fitToParts(lib, bp);
              break;
            case "restore": {
              if (isNew) throw new LibraryError("Only a saved blueprint has versions.");
              const version = (await listVersions(ctx.db, ctx.run.workspaceId, bp.id)).find((v) => v.revision === op.revision);
              if (!version) throw new LibraryError(`There is no version ${op.revision}.`);
              r = { ok: true, blueprint: { ...(blueprintBody.parse(version.body) as Omit<Blueprint, "id" | "revision">), id: bp.id, revision: bp.revision }, summary: `Restored version ${op.revision}` };
              break;
            }
          }
          if (!r.ok) return { content: `Operation ${i + 1} (${op.op}) failed: ${r.error} Nothing was saved.`, isError: true };
          bp = r.blueprint;
          changes.push(r.summary);
          if ("ref" in op && op.ref && r.partId) made[op.ref] = r.partId;
        }
        const body = bodyOf(bp);
        const saved = isNew ? await createEntry(ctx.db, ctx.run.workspaceId, ctx.run.userId, "blueprint", body) : await updateEntry(ctx.db, ctx.run.workspaceId, ctx.run.userId, bp.id, bp.revision, body);
        const after = resolver(await listLibrary(ctx.db, ctx.run.workspaceId));
        const entry = saved.entry as Blueprint;
        const refs = Object.entries(made);
        return {
          content: [
            isNew ? `Saved as a new blueprint, ${entry.name} [${entry.id}]${start.basedOn && isStandard(start.basedOn) ? ` (a copy of the default ${start.basedOn}; the default is unchanged)` : ""}.` : `Saved ${entry.name}, version ${entry.revision}; every plan and blueprint using it shows the change. restore with revision ${entry.revision - 1} takes it back.`,
            ...changes.map((c) => `- ${c}`),
            refs.length ? `Part ids: ${refs.map(([k, v]) => `${k} = ${v}`).join(", ")}` : "",
            "",
            describeBlueprint(after, entry),
          ]
            .join("\n"),
          libraryChanged: true,
          blueprintMade: { id: entry.id, name: entry.name },
        };
      } catch (err) {
        if (err instanceof LibraryConflictError && !attempt) continue;
        if (err instanceof LibraryConflictError) return { content: "Someone else was saving that blueprint at the same moment. Read it again and retry.", isError: true };
        if (err instanceof LibraryError || err instanceof z.ZodError) return { content: err instanceof z.ZodError ? `That would not save: ${z.prettifyError(err)}` : err.message, isError: true };
        throw err;
      }
    }
    return { content: "The blueprint kept changing. Try again.", isError: true };
  },
});

registerTool({
  name: "edit_material",
  anywhere: true,
  module: "floor_plan_editor",
  label: "Adding a material",
  description:
    "Adds or changes a material in the design library: a colour with a drawn pattern (wood, planks, herringbone, tiles, brick, concrete, marble, terrazzo, fabric, carpet, metal), a free CC0 texture from Poly Haven (search_free_textures gives ids), or a texture the AI makes from a description (costs one image). Changing a material changes everything using it. Defaults cannot change; changing one saves a copy.",
  input: z.object({
    material: z.string().max(120).optional().describe("Id or name of the material to change; leave out to add one."),
    name: z.string().min(1).max(120).optional(),
    category: z.enum(MATERIAL_CATEGORIES).optional(),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
    pattern: z.enum(["plain", "wood", "planks", "tiles", "brick", "concrete", "marble", "fabric", "carpet", "metal", "terrazzo", "herringbone"]).optional(),
    roughness: z.number().min(0).max(1).optional(),
    metalness: z.number().min(0).max(1).optional(),
    opacity: z.number().min(0.05).max(1).optional(),
    tile: z.number().min(50).max(20_000).optional().describe("Real size one repeat covers, mm."),
    freeTexture: z.string().max(80).optional().describe("A Poly Haven texture id to bring in."),
    aiTexture: z.string().min(3).max(600).optional().describe("Describe the texture for the AI to make."),
  }),
  async run(ctx, input) {
    const denied = await mayChange(ctx);
    if (denied) return { content: denied, isError: true };
    const lib = resolver(await listLibrary(ctx.db, ctx.run.workspaceId));
    const current = input.material ? findMaterial(lib, input.material) : undefined;
    if (input.material && !current) return { content: `There is no material "${input.material}".`, isError: true };
    let body: Record<string, unknown> = current ? bodyOf(current) : { name: input.name ?? "New material", category: input.category ?? "Other", color: input.color ?? "#c9c3b8", roughness: 0.8, metalness: 0, pattern: "plain" };
    try {
      if (input.freeTexture) body = { ...body, ...(await importFree(input.freeTexture, ctx.fetchImpl)) };
      if (input.aiTexture) {
        if (ctx.features && !ctx.features.ai) return { content: "AI is not enabled here.", isError: true };
        const { costZar: _c, ...made } = await aiTexture(ctx.db, ctx.run, { description: input.aiTexture, name: input.name ?? String(body.name), category: input.category ?? (body.category as Material["category"]), color: input.color ?? String(body.color), tile: input.tile ?? Number(body.tile ?? 1_000) });
        void _c;
        body = { ...body, ...made };
      }
    } catch (err) {
      if (err instanceof TextureSourceError) return { content: err.message, isError: true };
      throw err;
    }
    const { material: _m, freeTexture: _f, aiTexture: _a, ...fields } = input;
    void _m;
    void _f;
    void _a;
    for (const [k, v] of Object.entries(fields)) if (v !== undefined) body[k] = v;
    if (fields.pattern && !input.freeTexture && !input.aiTexture) delete body.image;
    const parsed = materialBody.safeParse(body);
    if (!parsed.success) return { content: `That would not save: ${z.prettifyError(parsed.error)}`, isError: true };
    try {
      const saved = current && !isStandard(current.id) ? await updateEntry(ctx.db, ctx.run.workspaceId, ctx.run.userId, current.id, current.revision, parsed.data) : await createEntry(ctx.db, ctx.run.workspaceId, ctx.run.userId, "material", current ? { ...parsed.data, name: input.name ?? `${current.name} (ours)` } : parsed.data);
      const m = saved.entry as Material;
      return { content: `${current && !isStandard(current.id) ? "Saved" : "Added"} ${m.name} [${m.id}]: ${m.category}, ${m.color}${m.image ? ", textured" : ""}${m.source ? `, from ${m.source.name}${m.source.licence ? ` (${m.source.licence})` : ""}` : ""}.`, libraryChanged: true };
    } catch (err) {
      if (err instanceof LibraryConflictError) return { content: "Someone else saved that material at the same moment. Try again.", isError: true };
      if (err instanceof LibraryError) return { content: err.message, isError: true };
      throw err;
    }
  },
});

registerTool({
  name: "search_free_textures",
  anywhere: true,
  module: "floor_plan_editor",
  label: "Searching free textures",
  description: "Searches Poly Haven's free (CC0) texture library by words, e.g. \"oak floor\" or \"terrazzo\". Bring one in with edit_material freeTexture.",
  input: z.object({ search: z.string().min(1).max(120) }),
  async run(ctx, input) {
    try {
      const list = await searchFree(input.search, ctx.fetchImpl, 24);
      if (!list.length) return { content: `No free textures match "${input.search}". Try one simpler word.` };
      return { content: list.map((t) => `- ${t.name} [${t.id}] ${t.categories.slice(0, 4).join(", ")}, one repeat ${t.tile} mm`).join("\n") };
    } catch (err) {
      if (err instanceof TextureSourceError) return { content: err.message, isError: true };
      throw err;
    }
  },
});
