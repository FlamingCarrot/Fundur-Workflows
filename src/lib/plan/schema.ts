import { z } from "zod";
import { LIMITS } from "./geometry";

/**
 * What the server accepts as a plan. The editor only produces valid geometry,
 * but the server checks the shape and the sizes again so a bad request cannot
 * store something the editor would choke on.
 */

const coord = z.number().finite().min(-LIMITS.maxCoord).max(LIMITS.maxCoord);
const point = z.object({ x: coord, y: coord });
const size = z.number().finite().positive().max(LIMITS.maxWall);
const id = z.string().min(1).max(64);

export const planSchema = z.object({
  version: z.literal(1),
  walls: z.array(z.object({ id, a: point, b: point, thickness: size })).max(20_000),
  openings: z
    .array(z.object({ id, wallId: id, kind: z.enum(["door", "window"]), at: z.number().finite(), width: size }))
    .max(5_000),
  columns: z.array(z.object({ id, at: point, width: size, depth: size })).max(5_000),
  rooms: z
    .array(z.object({ id, name: z.string().max(120), points: z.array(point).min(3).max(2_000), usable: z.boolean() }))
    .max(2_000),
  reference: z.array(z.object({ a: point, b: point, layer: z.string().max(255) })).max(50_000),
  source: z
    .object({
      name: z.string().max(255),
      format: z.literal("dxf"),
      importedAt: z.string().max(40),
      warnings: z.array(z.string().max(1_000)).max(200),
    })
    .optional(),
});

export const savePlanInput = z.object({
  plan: planSchema,
  /** The revision the editor started from; null for a project with no plan yet. */
  baseRevision: z.number().int().min(0).nullable(),
  /** One line per change since the last save, for the corrections log. */
  changes: z.array(z.string().trim().min(1).max(1_000)).max(500),
});

export const versionLabel = z.object({ label: z.string().trim().min(1).max(255) });
