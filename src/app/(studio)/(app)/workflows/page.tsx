import { notFound } from "next/navigation";
import { getViewer } from "@/lib/server/workspace-context";
import { WorkflowView } from "@/components/workflows/WorkflowView";
export default async function WorkflowsPage() {
  if ((await getViewer()).workspaceRole !== "owner") notFound();
  return <WorkflowView />;
}
