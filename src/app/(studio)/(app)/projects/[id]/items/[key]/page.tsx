import { notFound } from "next/navigation";
import { getViewer } from "@/lib/server/workspace-context";
import { ItemsView } from "@/components/design/ItemsView";
export default async function ItemsPage({
  params,
}: {
  params: Promise<{ id: string; key: string }>;
}) {
  if ((await getViewer()).features?.design === false) notFound();
  const { id, key } = await params;
  return <ItemsView projectId={id} registerKey={key} />;
}
