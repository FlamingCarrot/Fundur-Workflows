import type { Blueprint } from "@/lib/blueprints/types";
import type { BlueprintEdit } from "@/lib/blueprints/edit";
import type { ProjectDocument } from "@/lib/studio/types";
import { gameAssetSchema, type GameAsset } from "./schema";

export type AssetReference = GameAsset["references"][number];
export const REFERENCE_VIEWS = ["front", "side", "back", "perspective", "sheet", "other"] as const;
const imageName = /\.(png|jpe?g|webp)$/i;
const documentId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function referenceImages(documents: ProjectDocument[]): ProjectDocument[] {
  return documents.filter(d => d.stored && documentId.test(d.id) && imageName.test(d.name));
}

/** Only files actually listed in this project can become an image URL. */
export function referencePreview(projectId: string, documents: ProjectDocument[], reference: AssetReference): string | null {
  const doc = referenceImages(documents).find(d => d.id === reference.documentId);
  return doc ? `/api/projects/${encodeURIComponent(projectId)}/documents/${encodeURIComponent(doc.id)}/file?inline=1` : null;
}

export function setAssetReferences(bp: Blueprint, references: AssetReference[]): BlueprintEdit {
  if (!bp.gameAsset) return { ok: false, error: "This model has no asset-production brief." };
  const parsed = gameAssetSchema.shape.references.safeParse(references);
  if (!parsed.success) return { ok: false, error: "Keep up to 12 references with valid filenames, views and sheet labels." };
  return { ok: true, blueprint: { ...bp, gameAsset: { ...bp.gameAsset, references: parsed.data } }, summary: "Asset references updated" };
}

export function linkAssetReference(bp: Blueprint, projectId: string, documents: ProjectDocument[], id: string, view: AssetReference["view"]): BlueprintEdit {
  if (bp.gameAsset?.projectId !== projectId) return { ok: false, error: "Choose a reference from this asset's project." };
  const doc = referenceImages(documents).find(d => d.id === id);
  if (!doc) return { ok: false, error: "Choose a stored image from this project." };
  if (bp.gameAsset.references.some(r => r.documentId === id && r.view === view)) return { ok: false, error: "This image is already linked with that view label." };
  return setAssetReferences(bp, [...bp.gameAsset.references, { documentId: id, fileName: doc.name, view }]);
}
