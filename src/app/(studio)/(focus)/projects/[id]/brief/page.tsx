import { BriefView } from "@/components/views/BriefView";

export default async function BriefPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <BriefView projectId={id} />;
}
