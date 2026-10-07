import { NextRequest, NextResponse } from "next/server";
import { projectMutation } from "@/lib/projects/mutations";
import { checkStoredFiles } from "@/lib/projects/files";
import { applyMutation, getProject, MutationError, projectDbId } from "@/lib/projects/store";
import { requireProject, requirePermission, requireFeature } from "@/lib/server/workspace-context";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const ws = await requireProject((await ctx.params).id, "project:view");
  if (ws instanceof NextResponse) return ws;
  const project = await getProject(ws.db, ws.workspaceId, (await ctx.params).id);
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });
  return NextResponse.json({ project: ws.workspaceRole === "collaborator" ? { ...project, aiSpendZar: 0, briefCostZar: undefined } : project });
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
  if (parsed.data.type === "setClientVisible" || (parsed.data.type === "addDocuments" && parsed.data.documents.some(d => d.clientVisible))) {
    const unavailable = requireFeature(ws, "sharing") || requirePermission(ws, "document:share");
    if (unavailable) return unavailable;
  }
  const slug = (await ctx.params).id;
  try {
    let mutation = parsed.data;
    if (mutation.type === "addDocuments" || mutation.type === "replaceDocumentFile") {
      const projectId = await projectDbId(ws.db, ws.workspaceId, slug);
      if (!projectId) return NextResponse.json({ error: "Project not found" }, { status: 404 });
      mutation = await checkStoredFiles(mutation, ws.workspaceId, projectId);
    }
    const project = await applyMutation(ws.db, ws.workspaceId, slug, mutation);
    if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });
    return NextResponse.json({ project: ws.workspaceRole === "collaborator" ? { ...project, aiSpendZar: 0, briefCostZar: undefined } : project });
  } catch (err) {
    if (err instanceof MutationError) return NextResponse.json({ error: err.message }, { status: 400 });
    throw err;
  }
}
