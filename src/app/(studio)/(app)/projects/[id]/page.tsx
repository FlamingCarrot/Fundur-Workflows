import { ProjectView } from "@/components/views/ProjectView";

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ProjectView projectId={id} />;
}
