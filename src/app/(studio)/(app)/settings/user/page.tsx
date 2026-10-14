import { getViewer } from "@/lib/server/workspace-context";
import { UserSettingsView } from "@/components/views/UserSettingsView";
import { PROVIDERS } from "@/lib/ai/catalog";

export const dynamic = "force-dynamic";

export default async function UserSettingsPage() {
  const viewer = await getViewer();
  return <UserSettingsView viewer={viewer} providers={Object.values(PROVIDERS)} />;
}
