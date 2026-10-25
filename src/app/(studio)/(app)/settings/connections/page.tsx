import { getViewer } from "@/lib/server/workspace-context";
import { ConnectionsView } from "@/components/views/ConnectionsView";

export const dynamic = "force-dynamic";

export default async function ConnectionsPage() {
  const viewer = await getViewer();
  return <ConnectionsView showTabs={viewer.isAdmin} />;
}
