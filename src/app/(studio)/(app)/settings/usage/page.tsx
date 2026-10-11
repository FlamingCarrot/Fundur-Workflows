import { notFound } from "next/navigation";
import { UsageView } from "@/components/views/UsageView";
import { getViewer } from "@/lib/server/workspace-context";

export const dynamic = "force-dynamic";

/** Live view, usage overview and heat maps, for the Admin only. */
export default async function UsagePage() {
  const viewer = await getViewer();
  if (!viewer.isAdmin) notFound();
  return <UsageView />;
}
