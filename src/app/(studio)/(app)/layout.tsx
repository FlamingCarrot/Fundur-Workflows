import { AppShell } from "@/components/shell/AppShell";

import { StudioNavigation } from "@/components/shell/StudioNavigation";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <StudioNavigation><AppShell>{children}</AppShell></StudioNavigation>;
}
