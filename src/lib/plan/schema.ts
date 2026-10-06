import { z } from "zod";
import { adjacencySchema, rulesSchema } from "@/lib/layout/rules";
import { LIMITS, openingsFit, wallLength, type Plan } from "./geometry";

/**
 * What the server accepts as a plan. The editor only produces valid geometry,
 * but the server checks the shape and the sizes again so a bad request cannot
 * store something the editor would choke on.
 */

const coord = z.number().finite().min(-LIMITS.maxCoord).max(LIMITS.maxCoord);
const point = z.object({ x: coord, y: coord });
const size = z.number().finite().positive().max(LIMITS.maxWall);
const id = z.string().min(1).max(64);

const levelId = id.optional();
const label = z.string().max(500);

const item = z.object({
  id,
  levelId,
  type: z.string().min(1).max(64),
  at: point,
  width: size,
  depth: size,
  rotation: z.number().finite(),
  label: z.string().max(120).optional(),
});

const layout = z.object({
  id,
  name: z.string().min(1).max(120),
  levelId: id,
  createdAt: z.string().max(40),
  summary: z.string().max(1_000),
  ruleSetName: z.string().max(120),
  rules: rulesSchema,
  headcount: z.number().int().positive().max(100_000).nullable(),
  departments: z.array(z.object({ name: z.string().min(1).max(120), headcount: z.number().int().positive().max(100_000) })).max(200),
  adjacencies: z.array(adjacencySchema).max(200),
  items: z.array(item.extend({ levelId: id })).max(5_000),
  chosen: z.boolean().optional(),
  chosenAt: z.string().max(40).optional(),
  notes: z.string().max(10_000).optional(),
});

export const planSchema = z.object({
  version: z.literal(1),
  levels: z
    .array(z.object({ id, name: z.string().min(1).max(120), elevation: z.number().finite().min(-100_000).max(1_000_000), height: size }))
    .max(200)
    .optional(),
  walls: z
    .array(
      z.object({
        id,
        levelId,
        a: point,
        b: point,
        thickness: size,
        kind: z.enum(["wall", "partition"]).optional(),
        height: size.optional(),
      })
    )
    .max(20_000),
  openings: z
    .array(
      z.object({
        id,
        wallId: id,
        kind: z.enum(["door", "window"]),
        at: z.number().finite(),
        width: size,
        style: z.enum(["single", "double", "sliding", "opening"]).optional(),
        hinge: z.enum(["start", "end"]).optional(),
        side: z.union([z.literal(1), z.literal(-1)]).optional(),
        height: size.optional(),
        sill: z.number().finite().min(0).max(LIMITS.maxWall).optional(),
      })
    )
    .max(5_000),
  columns: z.array(z.object({ id, levelId, at: point, width: size, depth: size, round: z.boolean().optional() })).max(5_000),
  rooms: z
    .array(z.object({ id, levelId, name: z.string().max(120), points: z.array(point).min(3).max(2_000), usable: z.boolean() }))
    .max(2_000),
  items: z.array(item).max(20_000).optional(),
  notes: z.array(z.object({ id, levelId, at: point, text: label.min(1) })).max(5_000).optional(),
  dimensions: z.array(z.object({ id, levelId, a: point, b: point, offset: z.number().finite() })).max(5_000).optional(),
  // A server plan points at the uploaded image; the image itself (src) is only kept in the demo, so it is dropped here.
  underlays: z
    .array(
      z.object({
        levelId: id,
        name: z.string().max(255),
        documentId: z.uuid().optional(),
        at: point,
        width: size,
        pixelWidth: z.number().int().positive().max(100_000),
        pixelHeight: z.number().int().positive().max(100_000),
        opacity: z.number().min(0).max(1),
      })
    )
    .max(200)
    .optional(),
  reference: z.array(z.object({ levelId, a: point, b: point, layer: z.string().max(255) })).max(50_000),
  layouts: z.array(layout).max(50).optional(),
  source: z
    .object({
      name: z.string().max(255),
      format: z.literal("dxf"),
      importedAt: z.string().max(40),
      warnings: z.array(z.string().max(1_000)).max(200),
    })
    .optional(),
}).superRefine((plan, ctx) => {
  // Doors and windows must sit on a wall of the plan, inside it and clear of each other, as the editor keeps them.
  const walls = new Map(plan.walls.map((w) => [w.id, w]));
  plan.openings.forEach((o, i) => {
    if (!walls.has(o.wallId)) ctx.addIssue({ code: "custom", path: ["openings", i, "wallId"], message: "An opening is on a wall that is not in the plan" });
  });
  for (const wallId of new Set(plan.openings.map((o) => o.wallId))) {
    const wall = walls.get(wallId);
    if (!wall) continue;
    const problem = openingsFit(plan as unknown as Plan, wallId, wallLength(wall as Plan["walls"][number]));
    if (problem) ctx.addIssue({ code: "custom", path: ["openings"], message: problem });
  }
});

export const savePlanInput = z.object({
  plan: planSchema,
  /** The revision the editor started from; null for a project with no plan yet. */
  baseRevision: z.number().int().min(0).nullable(),
  /** One line per change since the last save, for the corrections log. */
  changes: z.array(z.string().trim().min(1).max(1_000)).max(500),
});

export const versionLabel = z.object({ label: z.string().trim().min(1).max(255) });
