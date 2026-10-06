import { DocumentsView } from "@/components/views/DocumentsView";

export default async function DocumentsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <DocumentsView projectId={id} />;
}
