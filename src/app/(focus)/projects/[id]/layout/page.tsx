import { LayoutView } from "@/components/layout/LayoutView";

export default async function LayoutPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <LayoutView projectId={id} />;
}
