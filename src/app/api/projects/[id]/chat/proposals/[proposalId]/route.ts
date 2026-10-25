import { NextRequest, NextResponse } from "next/server";
import { actOnProposal, ProposalActionError } from "@/lib/ai/proposal-actions";
import { projectDbId } from "@/lib/projects/store";
import { requireProject } from "@/lib/server/workspace-context";
import { limitResponse, PlanLimitError } from "@/lib/billing/guard";

export const dynamic = "force-dynamic";

/**
 * Confirms or dismisses a change the assistant proposed, or undoes one it made
 * straight away (src/lib/ai/proposal-actions.ts). The project (or, for a new
 * project, the new one) comes back as saved.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string; proposalId: string }> }) {
  const ws = await requireProject((await ctx.params).id, "ai:use", "ai");
  if (ws instanceof NextResponse) return ws;
  const { id: slug, proposalId } = await ctx.params;
  const { action } = ((await req.json().catch(() => null)) ?? {}) as { action?: unknown };
  if (action !== "apply" && action !== "dismiss" && action !== "undo") {
    return NextResponse.json({ error: "Say apply, dismiss or undo" }, { status: 400 });
  }
  const projectId = await projectDbId(ws.db, ws.workspaceId, slug);
  if (!projectId) return NextResponse.json({ error: "Project not found" }, { status: 404 });
  try {
    return NextResponse.json(await actOnProposal(ws, slug, projectId, proposalId, action));
  } catch (err) {
    if (err instanceof ProposalActionError) return NextResponse.json({ error: err.message }, { status: err.status });
    if (err instanceof PlanLimitError) return limitResponse(err);
    throw err;
  }
}
