import { NextResponse } from "next/server";
import { projectDbId } from "@/lib/projects/store";
import { requireFeature, requirePermission, requireProject, requireWorkspace, type WorkspaceContext } from "@/lib/server/workspace-context";

/**
 * Who is asking and what of the assistant's they reach (memories, documents): the studio's always, and a
 * project's when `?project=` names one they can use the assistant on.
 */
export async function assistantScope(project: string | null): Promise<(WorkspaceContext & { projectId: string | null }) | NextResponse> {
  if (project) {
    const pc = await requireProject(project, "ai:use", "ai");
    if (pc instanceof NextResponse) return pc;
    const projectId = await projectDbId(pc.db, pc.workspaceId, project);
    if (!projectId) return NextResponse.json({ error: "Project not found" }, { status: 404 });
    return { ...pc, projectId };
  }
  const ws = await requireWorkspace();
  if (ws instanceof NextResponse) return ws;
  return requirePermission(ws, "ai:use") ?? requireFeature(ws, "ai") ?? { ...ws, projectId: null };
}
