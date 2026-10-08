import { notFound } from "next/navigation";
import { getViewer } from "@/lib/server/workspace-context";
import { WorkflowBuilder } from "@/components/workflows/WorkflowBuilder";
export default async function WorkflowBuilderPage() {
  if ((await getViewer()).workspaceRole !== "owner") notFound();
  return <WorkflowBuilder />;
}
