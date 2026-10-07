import { NextRequest, NextResponse } from "next/server";
import { applyAction, parseAction, undoFor } from "@/lib/ai/actions";
import { markUndone, pendingProposal, resolveProposal, undoableProposal } from "@/lib/ai/chat-store";
import { undoPlanEdit } from "@/lib/ai/tools/plan-edit";
import { checkStoredFiles } from "@/lib/projects/files";
import { getProject, MutationError, projectDbId } from "@/lib/projects/store";
import { requireWorkspace } from "@/lib/server/workspace-context";

export const dynamic = "force-dynamic";

/**
 * Confirms or dismisses a change the assistant proposed, or undoes one it made
 * straight away. Confirming applies the same change she would make herself, so
 * it is saved, versioned and undoable like any of her edits; the project (or,
 * for a new project, the new one) comes back as saved.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string; proposalId: string }> }) {
  const ws = await requireWorkspace();
  if (ws instanceof NextResponse) return ws;
  const { id: slug, proposalId } = await ctx.params;
  const { action } = ((await req.json().catch(() => null)) ?? {}) as { action?: unknown };
  if (action !== "apply" && action !== "dismiss" && action !== "undo") {
    return NextResponse.json({ error: "Say apply, dismiss or undo" }, { status: 400 });
  }
  const projectId = await projectDbId(ws.db, ws.workspaceId, slug);
  if (!projectId) return NextResponse.json({ error: "Project not found" }, { status: 404 });
  if (!/^[0-9a-f-]{36}$/i.test(proposalId)) return NextResponse.json({ error: "No such change" }, { status: 404 });

  if (action === "undo") {
    const done = await undoableProposal(ws.db, ws.workspaceId, projectId, proposalId);
    if (!done) return NextResponse.json({ error: "That change was already undone" }, { status: 409 });
    try {
      if (done.mutation.type === "planEdit") {
        const plan = await undoPlanEdit(ws.db, ws.workspaceId, ws.user.id, slug, done.mutation, done.undo);
        await markUndone(ws.db, ws.workspaceId, done.id, ws.user.id);
        return NextResponse.json({ status: "undone", plan });
      }
      const undo = parseAction(done.undo);
      if (!undo) throw new MutationError("That change can no longer be undone");
      const project = await applyAction(ws.db, ws.workspaceId, slug, undo);
      await markUndone(ws.db, ws.workspaceId, done.id, ws.user.id);
      return NextResponse.json({ status: "undone", project });
    } catch (err) {
      if (err instanceof MutationError) return NextResponse.json({ error: err.message }, { status: 400 });
      throw err;
    }
  }

  const proposal = await pendingProposal(ws.db, ws.workspaceId, projectId, proposalId);
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
    let change = proposal.mutation;
    if (change.type === "addDocuments" || change.type === "replaceDocumentFile") change = await checkStoredFiles(change, ws.workspaceId, projectId);
    const before = await getProject(ws.db, ws.workspaceId, slug);
    const project = await applyAction(ws.db, ws.workspaceId, slug, change);
    // Confirmed changes that can be taken back get an Undo too.
    const undo = before ? undoFor(before, change) : null;
    if (undo) await ws.db.query("UPDATE ai_proposals SET undo = $2::jsonb WHERE id = $1", [proposal.id, JSON.stringify(undo)]);
    return NextResponse.json({
      status: "applied",
      undoable: !!undo,
      ...(change.type === "createProject" ? { created: project } : { project }),
    });
  } catch (err) {
    await ws.db.query("UPDATE ai_proposals SET status = 'pending', resolved_at = NULL, resolved_by = NULL WHERE id = $1", [proposal.id]);
    if (err instanceof MutationError) return NextResponse.json({ error: err.message }, { status: 400 });
    throw err;
  }
}
