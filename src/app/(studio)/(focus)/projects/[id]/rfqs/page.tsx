import { notFound } from "next/navigation";
import { getViewer } from "@/lib/server/workspace-context";
import { RfqsView } from "@/components/sourcing/RfqsView";
export default async function RfqsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  if ((await getViewer()).features?.design === false) notFound();
  return <RfqsView projectId={(await params).id} />;
}
