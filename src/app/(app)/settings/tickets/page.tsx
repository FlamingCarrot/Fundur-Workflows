import { notFound } from "next/navigation";
import { TicketQueueView } from "@/components/views/TicketQueueView";
import { getViewer } from "@/lib/server/workspace-context";

export const dynamic = "force-dynamic";

/** The Admin's ticket queue (P1-19). Anyone else gets a plain not-found. */
export default async function TicketsPage() {
  const viewer = await getViewer();
  if (!viewer.isAdmin) notFound();
  return <TicketQueueView />;
}
