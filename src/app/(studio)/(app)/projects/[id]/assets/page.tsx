import { notFound } from "next/navigation";
import { getViewer } from "@/lib/server/workspace-context";
import { GameAssetStudio } from "@/components/game-assets/GameAssetStudio";

export default async function GameAssetsPage({ params }: { params: Promise<{ id: string }> }) {
  if ((await getViewer()).features?.floor_plan === false) notFound();
  const { id } = await params;
  return <GameAssetStudio projectId={id} />;
}
