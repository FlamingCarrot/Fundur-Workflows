import { AiSpendView } from "@/components/views/AiSpendView";

export default async function AiSpendPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <AiSpendView projectId={id} />;
}
