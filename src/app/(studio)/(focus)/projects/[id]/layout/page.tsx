import { notFound } from "next/navigation";
import { getViewer } from "@/lib/server/workspace-context";
import { LayoutView } from "@/components/layout/LayoutView";

export default async function LayoutPage({ params }: { params: Promise<{ id: string }> }) {
  const viewer = await getViewer();
  if (viewer.features?.layout === false) notFound();
  const { id } = await params;
  return <LayoutView projectId={id} />;
}
