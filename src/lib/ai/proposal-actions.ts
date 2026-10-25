import { applyAction, parseAction, undoFor } from "./actions";
import { markUndone, pendingProposal, resolveProposal, undoableProposal } from "./chat-store";
import { undoPlanEdit } from "./tools/plan-edit";
import { undoBoardEdit } from "./tools/board";
import { checkStoredFiles } from "@/lib/projects/files";
import { getProject, MutationError } from "@/lib/projects/store";
import { hasPermission } from "@/lib/auth/permissions";
import { assertCanCreateProject, assertFeature } from "@/lib/billing/guard";
import type { WorkspaceContext } from "@/lib/server/workspace-context";

/**
 * Confirms or dismisses a change the assistant proposed, or undoes one it made
 * straight away: the chat's buttons, and the same for apps connected over MCP.
 * Confirming applies the same change she would make herself, so it is saved,
 * versioned and undoable like any of her edits.
 */

export type ProposalVerb = "apply" | "dismiss" | "undo";

/** Why a change could not be confirmed, dismissed or undone; `status` is the HTTP status to answer with. */
export class ProposalActionError extends Error {
  constructor(
    public status: 400 | 403 | 404 | 409,
    message: string
  ) {
    super(message);
  }
}

export type ProposalActionResult =
  | { status: "undone"; plan?: unknown; board?: unknown; project?: unknown }
  | { status: "dismissed" }
  | { status: "applied"; undoable: boolean; project?: unknown; created?: unknown };

/** Plan limits (PlanLimitError) are thrown as they are, for the caller to answer. */
export async function actOnProposal(
  ws: WorkspaceContext,
  slug: string,
  projectId: string,
  proposalId: string,
  action: ProposalVerb
): Promise<ProposalActionResult> {
  if (!/^[0-9a-f-]{36}$/i.test(proposalId)) throw new ProposalActionError(404, "No such change");

  if (action === "undo") {
    const done = await undoableProposal(ws.db, ws.workspaceId, projectId, proposalId);
    if (!done) throw new ProposalActionError(409, "That change was already undone");
    try {
      if (done.mutation.type === "planEdit") {
        const plan = await undoPlanEdit(ws.db, ws.workspaceId, ws.user.id, slug, done.mutation, done.undo);
        await markUndone(ws.db, ws.workspaceId, done.id, ws.user.id);
        return { status: "undone", plan };
      }
      if (done.mutation.type === "boardEdit") {
        const board = await undoBoardEdit(ws.db, ws.workspaceId, ws.user.id, slug, done.mutation, done.undo);
        await markUndone(ws.db, ws.workspaceId, done.id, ws.user.id);
        return { status: "undone", board };
      }
      const undo = parseAction(done.undo);
      if (!undo) throw new MutationError("That change can no longer be undone");
      const project = await applyAction(ws.db, ws.workspaceId, slug, undo);
      await markUndone(ws.db, ws.workspaceId, done.id, ws.user.id);
      return { status: "undone", project };
    } catch (err) {
      if (err instanceof MutationError) throw new ProposalActionError(400, err.message);
      throw err;
    }
  }

  const proposal = await pendingProposal(ws.db, ws.workspaceId, projectId, proposalId);
  if (!proposal) throw new ProposalActionError(409, "That change was already confirmed or dismissed");

  if (action === "dismiss") {
    await resolveProposal(ws.db, ws.workspaceId, proposal.id, "dismissed", ws.user.id);
    return { status: "dismissed" };
  }
  // A new project needs the same rights and plan room as starting one by hand.
  if (proposal.mutation.type === "createProject" && !hasPermission("project:create", { workspaceRole: ws.workspaceRole })) {
    throw new ProposalActionError(403, "You do not have permission to do this");
  }
  // Claimed first, so two clicks cannot apply it twice; released again if applying fails.
  if (!(await resolveProposal(ws.db, ws.workspaceId, proposal.id, "applied", ws.user.id))) {
    throw new ProposalActionError(409, "That change was already confirmed or dismissed");
  }
  try {
    let change = proposal.mutation;
    if (change.type === "addDocuments" || change.type === "replaceDocumentFile") change = await checkStoredFiles(change, ws.workspaceId, projectId);
    if (change.type === "createProject") {
      await assertCanCreateProject(ws, change.project.workflowId);
      if (change.project.templateId) await assertFeature(ws, "templates", "Starting from a template is on the Paid plan.");
    }
    const before = await getProject(ws.db, ws.workspaceId, slug);
    const project = await applyAction(ws.db, ws.workspaceId, slug, change);
    // Confirmed changes that can be taken back get an Undo too.
    const undo = before ? undoFor(before, change) : null;
    if (undo) await ws.db.query("UPDATE ai_proposals SET undo = $2::jsonb WHERE id = $1", [proposal.id, JSON.stringify(undo)]);
    return { status: "applied", undoable: !!undo, ...(change.type === "createProject" ? { created: project } : { project }) };
  } catch (err) {
    await ws.db.query("UPDATE ai_proposals SET status = 'pending', resolved_at = NULL, resolved_by = NULL WHERE id = $1", [proposal.id]);
    if (err instanceof MutationError) throw new ProposalActionError(400, err.message);
    throw err;
  }
}
