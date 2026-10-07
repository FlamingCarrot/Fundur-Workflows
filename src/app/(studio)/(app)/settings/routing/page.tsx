import { notFound } from "next/navigation";
import { RoutingView } from "@/components/views/RoutingView";
import { getViewer } from "@/lib/server/workspace-context";

export const dynamic = "force-dynamic";

/** Which model tier each kind of AI work runs on, and its review retry cap (P4-13, P4-14). Admin only. */
export default async function RoutingPage() {
  const viewer = await getViewer();
  if (!viewer.isAdmin) notFound();
  return <RoutingView />;
}
