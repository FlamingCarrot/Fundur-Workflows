import { notFound } from "next/navigation";
import { getViewer } from "@/lib/server/workspace-context";
import { ClientViewManagerView } from "@/components/team/ClientViewManager";

/** The owner's side of the client's progress page. */
export default async function ClientViewPage({ params }: { params: Promise<{ id: string }> }) {
  if ((await getViewer()).features?.sharing === false) notFound();
  return <ClientViewManagerView projectId={(await params).id} />;
}
