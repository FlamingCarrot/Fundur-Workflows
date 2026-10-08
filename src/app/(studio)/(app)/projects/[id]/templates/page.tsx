import { notFound } from "next/navigation";
import { getViewer } from "@/lib/server/workspace-context";
import { TemplatesView } from "@/components/templates/TemplatesView";
export default async function TemplatesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  if ((await getViewer()).features?.design === false) notFound();
  return <TemplatesView projectId={(await params).id} />;
}
