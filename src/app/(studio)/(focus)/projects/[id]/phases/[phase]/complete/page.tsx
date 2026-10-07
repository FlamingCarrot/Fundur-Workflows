import { CompletePhaseFlow } from "@/components/views/CompletePhaseFlow";

export default async function CompletePhasePage({ params }: { params: Promise<{ id: string; phase: string }> }) {
  const { id, phase } = await params;
  return <CompletePhaseFlow projectId={id} phaseKey={phase} />;
}
