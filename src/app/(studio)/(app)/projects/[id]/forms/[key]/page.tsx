import { ProjectForm } from "@/components/workflows/ProjectForm";
export default async function FormPage({
  params,
}: {
  params: Promise<{ id: string; key: string }>;
}) {
  const { id, key } = await params;
  return <ProjectForm projectId={id} formKey={key} />;
}
