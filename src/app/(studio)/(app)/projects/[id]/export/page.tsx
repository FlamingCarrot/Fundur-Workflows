import { ProjectExportView } from "@/components/export/ProjectExportView";
export default async function ExportPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return <ProjectExportView projectId={(await params).id} />;
}
