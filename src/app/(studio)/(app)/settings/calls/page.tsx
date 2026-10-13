import { notFound } from "next/navigation";
import { CallSettingsPage } from "@/components/comms/CallSettings";
import { getViewer } from "@/lib/server/workspace-context";

export const dynamic = "force-dynamic";

/** How video calls are carried, recorded and transcribed, for the Admin only. */
export default async function CallsSettingsPage() {
  const viewer = await getViewer();
  if (!viewer.isAdmin) notFound();
  return <CallSettingsPage />;
}
