import { Suspense } from "react";
import { ProjectSettingsView } from "@/components/views/ProjectSettingsView";

export default async function ProjectSettingsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Suspense>
      <ProjectSettingsView projectId={id} />
    </Suspense>
  );
}
