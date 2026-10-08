import { notFound } from "next/navigation";
import { getViewer } from "@/lib/server/workspace-context";
import { ConceptView } from "@/components/concepts/ConceptView";
export default async function ConceptsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const viewer = await getViewer();
  if (
    viewer.features?.design === false ||
    viewer.features?.ai === false ||
    viewer.workspaceRole === "collaborator"
  )
    notFound();
  const { id } = await params;
  return <ConceptView projectId={id} />;
}
