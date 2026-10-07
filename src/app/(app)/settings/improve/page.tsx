import { notFound } from "next/navigation";
import { AdvisorView } from "@/components/views/AdvisorView";
import { getViewer } from "@/lib/server/workspace-context";

export const dynamic = "force-dynamic";

/** What to improve next, and why: the Admin's advisor. Anyone else gets a plain not-found. */
export default async function ImprovePage() {
  const viewer = await getViewer();
  if (!viewer.isAdmin) notFound();
  return <AdvisorView />;
}
