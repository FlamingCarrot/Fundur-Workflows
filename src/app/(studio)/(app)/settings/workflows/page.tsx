import { notFound } from "next/navigation";
import { getViewer } from "@/lib/server/workspace-context";
import { WorkflowBuilderAdmin } from "@/components/workflows/WorkflowBuilderAdmin";
export const dynamic = "force-dynamic";
export default async function WorkflowBuilderAdminPage() {
  if (!(await getViewer()).isAdmin) notFound();
  return <WorkflowBuilderAdmin />;
}
