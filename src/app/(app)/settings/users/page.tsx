import { notFound } from "next/navigation";
import { UsersView } from "@/components/views/UsersView";
import { getViewer } from "@/lib/server/workspace-context";

export const dynamic = "force-dynamic";

/** User management, for the Admin only. Anyone else, and the Admin in basic view, gets a plain not-found. */
export default async function UsersPage() {
  const viewer = await getViewer();
  if (!viewer.isAdmin) notFound();
  return <UsersView />;
}
