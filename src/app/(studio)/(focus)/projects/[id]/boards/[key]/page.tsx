import { notFound } from "next/navigation";
import { getViewer } from "@/lib/server/workspace-context";
import { BoardView } from "@/components/design/BoardView";
export default async function BoardPage({
  params,
}: {
  params: Promise<{ id: string; key: string }>;
}) {
  if ((await getViewer()).features?.design === false) notFound();
  const { id, key } = await params;
  return <BoardView projectId={id} boardKey={key} />;
}
