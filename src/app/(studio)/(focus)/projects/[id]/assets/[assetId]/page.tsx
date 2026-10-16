import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getViewer } from "@/lib/server/workspace-context";
import { AssetModeler } from "@/components/game-assets/AssetModeler";

export const metadata: Metadata = { title: "3D Asset Studio · Fundur" };
export default async function AssetModelerPage({ params }: { params: Promise<{ id: string; assetId: string }> }) {
  if ((await getViewer()).features?.floor_plan === false) notFound();
  const { id, assetId } = await params;
  return <AssetModeler projectId={id} assetId={assetId} />;
}
