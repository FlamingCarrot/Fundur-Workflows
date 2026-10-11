import { notFound } from "next/navigation";
import { getViewer } from "@/lib/server/workspace-context";
import { BriefDraftFlow } from "@/components/views/BriefDraftFlow";

export default async function BriefDraftPage({ params }: { params: Promise<{ id: string }> }) {
  const viewer = await getViewer();
  if (viewer.features?.ai === false || viewer.workspaceRole === "collaborator") notFound();
  const { id } = await params;
  return <BriefDraftFlow projectId={id} />;
}
