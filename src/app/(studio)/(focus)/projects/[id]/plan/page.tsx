import { notFound } from "next/navigation";
import { getViewer } from "@/lib/server/workspace-context";
import { PlanView } from "@/components/plan/PlanView";

export default async function PlanPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ layout?: string | string[] }>;
}) {
  const viewer = await getViewer();
  if (viewer.features?.floor_plan === false) notFound();
  const { id } = await params;
  const { layout } = await searchParams;
  return <PlanView projectId={id} layoutId={typeof layout === "string" ? layout : undefined} />;
}
