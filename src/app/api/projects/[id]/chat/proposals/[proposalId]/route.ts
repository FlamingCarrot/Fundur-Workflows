import { NextRequest, NextResponse } from "next/server";
import { pendingProposal, resolveProposal } from "@/lib/ai/chat-store";
import { checkStoredFiles } from "@/lib/projects/files";
import { applyMutation, MutationError, projectDbId } from "@/lib/projects/store";
import { requireProject } from "@/lib/server/workspace-context";

export const dynamic = "force-dynamic";

/**
 * Confirms or dismisses a change the assistant proposed. Confirming applies
 * the same project change she would make herself, so it is saved, versioned
 * and undoable like any of her edits; the project comes back as saved.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string; proposalId: string }> }) {
  const ws = await requireProject((await ctx.params).id, "ai:use", "ai");
  if (ws instanceof NextResponse) return ws;
  const { id: slug, proposalId } = await ctx.params;
  const { action } = ((await req.json().catch(() => null)) ?? {}) as { action?: unknown };
  if (action !== "apply" && action !== "dismiss") return NextResponse.json({ error: "Say apply or dismiss" }, { status: 400 });
  const projectId = await projectDbId(ws.db, ws.workspaceId, slug);
  if (!projectId) return NextResponse.json({ error: "Project not found" }, { status: 404 });
  const proposal = /^[0-9a-f-]{36}$/i.test(proposalId) ? await pendingProposal(ws.db, ws.workspaceId, projectId, proposalId) : null;
  if (!proposal) return NextResponse.json({ error: "That change was already confirmed or dismissed" }, { status: 409 });

  if (action === "dismiss") {
    await resolveProposal(ws.db, ws.workspaceId, proposal.id, "dismissed", ws.user.id);
    return NextResponse.json({ status: "dismissed" });
  }
  // Claimed first, so two clicks cannot apply it twice; released again if applying fails.
  if (!(await resolveProposal(ws.db, ws.workspaceId, proposal.id, "applied", ws.user.id))) {
    return NextResponse.json({ error: "That change was already confirmed or dismissed" }, { status: 409 });
  }
  try {
    const mutation = await checkStoredFiles(proposal.mutation, ws.workspaceId, projectId);
    const project = await applyMutation(ws.db, ws.workspaceId, slug, mutation);
    if (!project) throw new MutationError("Project not found");
    return NextResponse.json({ status: "applied", project });
  } catch (err) {
    await ws.db.query("UPDATE ai_proposals SET status = 'pending', resolved_at = NULL, resolved_by = NULL WHERE id = $1", [proposal.id]);
    if (err instanceof MutationError) return NextResponse.json({ error: err.message }, { status: 400 });
    throw err;
  }
}
