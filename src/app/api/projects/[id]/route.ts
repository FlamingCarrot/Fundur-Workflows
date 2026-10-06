import { NextRequest, NextResponse } from "next/server";
import { projectMutation } from "@/lib/projects/mutations";
import { applyMutation, getProject, MutationError } from "@/lib/projects/store";
import { requireWorkspace } from "@/lib/server/workspace-context";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const ws = await requireWorkspace();
  if (ws instanceof NextResponse) return ws;
  const project = await getProject(ws.db, ws.workspaceId, (await ctx.params).id);
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });
  return NextResponse.json({ project });
}

/** Applies one change (see projectMutation) and returns the project as saved. */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const ws = await requireWorkspace();
  if (ws instanceof NextResponse) return ws;
  const parsed = projectMutation.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  try {
    const project = await applyMutation(ws.db, ws.workspaceId, (await ctx.params).id, parsed.data);
    if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });
    return NextResponse.json({ project });
  } catch (err) {
    if (err instanceof MutationError) return NextResponse.json({ error: err.message }, { status: 400 });
    throw err;
  }
}
