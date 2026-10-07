import { notFound } from "next/navigation";
import { PlansAdminView } from "@/components/views/PlansAdminView";
import { getViewer } from "@/lib/server/workspace-context";

export const dynamic = "force-dynamic";

/** The Admin's plans, accounts and codes. Anyone else gets a plain not-found. */
export default async function PlansPage() {
  const viewer = await getViewer();
  if (!viewer.isAdmin) notFound();
  return <PlansAdminView />;
}
