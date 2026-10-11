import { notFound } from "next/navigation";
import { getViewer } from "@/lib/server/workspace-context";
import { RegulationsView } from "@/components/regulations/RegulationsView";
export default async function RegulationsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  if ((await getViewer()).features?.design === false) notFound();
  return <RegulationsView projectId={(await params).id} />;
}
