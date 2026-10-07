import { StudioProvider } from "@/components/providers/StudioProvider";
import { Overlays } from "@/components/shell/Overlays";
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
  return (
    <StudioProvider
      persistence={usesServerPersistence() ? "server" : "local"}
      viewer={await getViewer()}
      fileStorage={isStorageConfigured()}
    >
      {children}
      <Overlays />
    </StudioProvider>
  );
}
