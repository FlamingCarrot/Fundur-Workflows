import { notFound } from "next/navigation";
import { AiSettingsView } from "@/components/views/AiSettingsView";
import { PROVIDERS } from "@/lib/ai/catalog";
import { getViewer } from "@/lib/server/workspace-context";

export const dynamic = "force-dynamic";

/**
 * Platform settings, for the Admin only. Anyone else, and the open demo (which
 * has no sign-in and so no Admin), gets a plain not-found.
 */
export default async function SettingsPage() {
  const viewer = await getViewer();
  if (!viewer.isAdmin) notFound();
  return <AiSettingsView providers={Object.values(PROVIDERS)} />;
}
