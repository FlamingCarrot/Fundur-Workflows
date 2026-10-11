import { StudioProvider } from "@/components/providers/StudioProvider";
import { UsageTracker } from "@/components/analytics/UsageTracker";
import { Overlays } from "@/components/shell/Overlays";
import { AccessScreen } from "@/components/shell/AccessScreen";
import {
  getViewer,
  usesServerPersistence,
} from "@/lib/server/workspace-context";
import { isStorageConfigured } from "@/lib/storage/blob";

export default async function StudioLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const viewer = await getViewer();
  // Switched off, or waiting to be let in while sign-ups are invite only.
  if (viewer.access !== "active") return <AccessScreen access={viewer.access} email={viewer.email} />;
  return (
    <StudioProvider
      persistence={usesServerPersistence() ? "server" : "local"}
      viewer={viewer}
      fileStorage={isStorageConfigured()}
    >
      {children}
      <Overlays />
      <UsageTracker enabled={usesServerPersistence()} />
    </StudioProvider>
  );
}
