import { z } from "zod";
import { BLUEPRINT_CATEGORIES, MATERIAL_CATEGORIES } from "./types";
import { MESH_LIMITS } from "./mesh";

/**
 * What the server accepts as a blueprint or a material. The editor only makes
 * valid ones, but sizes and counts are checked again so nothing stored can
 * stall the 3D view.
 */

const MAX = 100_000;
const mm = z.number().finite().min(-MAX).max(MAX);
const size = z.number().finite().positive().max(MAX);
const ref = z.string().min(1).max(80);
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const share = z.number().finite().min(-0.001).max(1.001);

export const partSchema = z
  .object({
    id: z.string().min(1).max(64),
    name: z.string().trim().max(120).optional(),
    shape: z.enum(["box", "cylinder", "sphere", "wedge", "lathe", "extrude", "mesh"]).optional(),
    blueprintId: ref.optional(),
    at: z.object({ x: mm, y: mm, z: mm }),
    size: z.object({ w: size, d: size, h: size }),
    rotation: z.number().finite().min(-3600).max(3600),
    radius: z.number().finite().min(0).max(MAX).optional(),
    material: ref.optional(),
    taper: z.number().finite().min(0).max(4).optional(),
    profile: z.array(z.tuple([z.number().finite().min(0).max(1), z.number().finite().min(0).max(1)])).min(2).max(96).optional(),
    hollow: z.number().finite().positive().max(MAX).optional(),
    tilt: z.object({ x: z.number().finite().min(-90).max(90).optional(), y: z.number().finite().min(-90).max(90).optional() }).optional(),
    mesh: z
      .object({
        v: z.array(z.tuple([share, share, share])).min(3).max(MESH_LIMITS.points),
        f: z.array(z.array(z.number().int().min(0).max(MESH_LIMITS.points - 1)).min(3).max(MESH_LIMITS.perFace)).min(1).max(MESH_LIMITS.faces),
      })
      .refine((m) => m.f.every((f) => f.every((i) => i < m.v.length)), "A face uses a point the mesh does not have.")
      .optional(),
  })
  .refine((p) => !!p.shape !== !!p.blueprintId, "A part is either a shape or a nested blueprint.")
  .refine((p) => p.shape !== "extrude" || (p.profile?.length ?? 0) >= 3, "An extrusion needs an outline of three or more points.")
  .refine((p) => p.shape !== "lathe" || (p.profile?.length ?? 0) >= 2, "A lathe needs a profile of two or more points.")
  .refine((p) => (p.shape === "mesh") === !!p.mesh, "A mesh part needs its points and faces.");

export const layerSchema = z.object({ name: z.string().trim().min(1).max(80), thickness: z.number().finite().min(1).max(1_500), material: ref });

export const blueprintBody = z.object({
  name: z.string().trim().min(1).max(120),
  kind: z.enum(["object", "wall"]),
  category: z.enum(BLUEPRINT_CATEGORIES),
  type: z.string().min(1).max(64),
  size: z.object({ w: size, d: size, h: size }),
  parts: z.array(partSchema).max(400),
  layers: z.array(layerSchema).min(1).max(20).optional(),
  symbol: z.enum(["type", "parts"]),
  description: z.string().trim().max(2_000).optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  basedOn: ref.optional(),
});
export type BlueprintBody = z.infer<typeof blueprintBody>;

/** Textures kept in the library itself stay small: a 512 px JPEG is about 100 KB. */
const MAX_IMAGE = 400_000;
export const imageRef = z
  .string()
  .max(MAX_IMAGE)
  .refine((v) => /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(v) || /^\/api\/textures\/image\?/.test(v), "Use a small image or a texture from the free library.");

export const materialBody = z.object({
  name: z.string().trim().min(1).max(120),
  category: z.enum(MATERIAL_CATEGORIES),
  color,
  roughness: z.number().min(0).max(1),
  metalness: z.number().min(0).max(1),
  opacity: z.number().min(0.05).max(1).optional(),
  pattern: z.enum(["plain", "wood", "planks", "tiles", "brick", "concrete", "marble", "fabric", "carpet", "metal", "terrazzo", "herringbone"]).optional(),
  image: imageRef.optional(),
  tile: z.number().finite().min(10).max(20_000).optional(),
  source: z.object({ name: z.string().max(80), url: z.string().url().max(500).optional(), licence: z.string().max(80).optional() }).optional(),
});
export type MaterialBody = z.infer<typeof materialBody>;

export const entryInput = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("blueprint"), body: blueprintBody }),
  z.object({ kind: z.literal("material"), body: materialBody }),
]);

export const entryUpdate = z.object({
  /** The revision the change was made on; a newer one means someone else saved first. */
  baseRevision: z.number().int().min(1),
  body: z.union([blueprintBody, materialBody]),
});
