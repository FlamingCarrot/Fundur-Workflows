import { PlanView } from "@/components/plan/PlanView";

export default async function PlanPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PlanView projectId={id} />;
}
