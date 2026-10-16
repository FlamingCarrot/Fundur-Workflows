import { z } from "zod";

export const assetReferenceSchema = z.object({
  fileName: z.string().trim().min(1).max(255),
  view: z.enum(["front", "side", "back", "perspective", "sheet", "other"]),
  documentId: z.string().max(100).optional(),
  region: z.string().max(200).optional().describe("Label or row/column on an asset sheet"),
});

/** Versioned with the geometry so the production brief travels with the model. */
export const gameAssetSchema = z.object({
  projectId: z.string().min(1).max(100),
  assetKey: z.string().trim().min(1).max(80),
  status: z.enum(["queued", "modeling", "review", "blocked"]),
  references: z.array(assetReferenceSchema).max(12),
  engine: z.enum(["undecided", "unity", "unreal", "godot", "other"]),
  targetTriangles: z.number().int().min(12).max(1_000_000),
  textureSize: z.enum(["512", "1024", "2048", "4096"]),
  collision: z.enum(["none", "simple", "convex", "custom"]),
  rigging: z.enum(["static", "rigged", "animated"]),
  brief: z.string().max(4000),
  assumptions: z.array(z.string().max(500)).max(20),
  notes: z.string().max(2000),
});
export type GameAsset = z.infer<typeof gameAssetSchema>;
export function assetBrief(projectId: string, assetKey: string): GameAsset {
  return { projectId, assetKey, status: "queued", references: [], engine: "undecided", targetTriangles: 5000,
    textureSize: "1024", collision: "simple", rigging: "static", brief: "", assumptions: [], notes: "" };
}
