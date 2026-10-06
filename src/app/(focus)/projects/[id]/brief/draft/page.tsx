import { BriefDraftFlow } from "@/components/views/BriefDraftFlow";

export default async function BriefDraftPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <BriefDraftFlow projectId={id} />;
}
