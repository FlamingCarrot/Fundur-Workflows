import { PhaseView } from "@/components/views/PhaseView";

export default async function PhasePage({ params }: { params: Promise<{ id: string; phase: string }> }) {
  const { id, phase } = await params;
  return <PhaseView projectId={id} phaseKey={phase} />;
}
