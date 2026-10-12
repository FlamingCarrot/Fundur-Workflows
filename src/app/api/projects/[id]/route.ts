import { NextRequest, NextResponse } from "next/server";
import { projectMutation } from "@/lib/projects/mutations";
import { checkStoredFiles } from "@/lib/projects/files";
import { applyMutation, deleteProject, getProject, MutationError, projectDbId } from "@/lib/projects/store";
import { refuseMutation } from "@/lib/team/access";
import { requireProject, requirePermission, requireFeature, type ProjectContext } from "@/lib/server/workspace-context";
import type { Project } from "@/lib/studio/types";

export const dynamic = "force-dynamic";

/** The project as this person may see it: no spend for collaborators, and their own access when narrowed. */
function forViewer(ws: ProjectContext, project: Project): Project {
  return {
    ...(ws.workspaceRole === "collaborator" ? { ...project, aiSpendZar: 0, briefCostZar: undefined } : project),
    ...(ws.projectAccess ? { myAccess: ws.projectAccess } : {}),
  };
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const ws = await requireProject((await ctx.params).id, "project:view");
  if (ws instanceof NextResponse) return ws;
  const project = await getProject(ws.db, ws.workspaceId, (await ctx.params).id);
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });
  return NextResponse.json({ project: forViewer(ws, project) });
}

/** Applies one change (see projectMutation) and returns the project as saved. */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const ws = await requireProject((await ctx.params).id, "project:edit");
  if (ws instanceof NextResponse) return ws;
  const parsed = projectMutation.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  const specialPermission = parsed.data.type === "setClientVisible" ? "document:share" : parsed.data.type === "setStatus" ? "project:archive" : parsed.data.type === "addDocuments" || parsed.data.type === "replaceDocumentFile" ? "document:upload" : "project:edit";
  const denied = requirePermission(ws, specialPermission);
  if (denied) return denied;
  // Project settings (details and the project's own phases and steps) are for the studio's people, not collaborators.
  if ((parsed.data.type === "customizeWorkflow" || parsed.data.type === "updateDetails") && ws.workspaceRole === "collaborator") {
    return NextResponse.json({ error: "Only the studio's own people can change project settings" }, { status: 403 });
  }
  if (parsed.data.type === "setRegulation" || parsed.data.type === "deleteRegulation") {
    const unavailable = requireFeature(ws, "design");
    if (unavailable) return unavailable;
  }
  if (parsed.data.type === "setClientVisible" || (parsed.data.type === "addDocuments" && parsed.data.documents.some(d => d.clientVisible))) {
    const unavailable = requireFeature(ws, "sharing") || requirePermission(ws, "document:share");
    if (unavailable) return unavailable;
  }
  const slug = (await ctx.params).id;
  if (ws.projectAccess) {
    const current = await getProject(ws.db, ws.workspaceId, slug);
    const refused = current && refuseMutation(current, ws.projectAccess, parsed.data);
    if (refused) return NextResponse.json({ error: refused }, { status: 403 });
  }
  try {
    let mutation = parsed.data;
    if (mutation.type === "addDocuments" || mutation.type === "replaceDocumentFile") {
      const projectId = await projectDbId(ws.db, ws.workspaceId, slug);
      if (!projectId) return NextResponse.json({ error: "Project not found" }, { status: 404 });
      mutation = await checkStoredFiles(mutation, ws.workspaceId, projectId);
    }
    const project = await applyMutation(ws.db, ws.workspaceId, slug, mutation);
    if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });
    return NextResponse.json({ project: forViewer(ws, project) });
  } catch (err) {
    if (err instanceof MutationError) return NextResponse.json({ error: err.message }, { status: 400 });
    throw err;
  }
}

/** Deletes the project with its documents, tasks, plans and AI history. Files already in storage are left there. */
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const ws = await requireProject((await ctx.params).id, "project:archive");
  if (ws instanceof NextResponse) return ws;
  const deleted = await deleteProject(ws.db, ws.workspaceId, (await ctx.params).id);
  if (!deleted) return NextResponse.json({ error: "Project not found" }, { status: 404 });
  return NextResponse.json({ deleted: true });
}
