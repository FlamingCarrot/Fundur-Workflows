import { NextResponse } from "next/server";
import { z } from "zod";
import { requireWorkspace, type WorkspaceContext } from "@/lib/server/workspace-context";
import { BusinessError } from "./store";

/** The studio's money is the owner's: proposals, invoices, orders, leads and settings. Time is everyone's own. */
export async function requireBusiness(owner = true): Promise<WorkspaceContext | NextResponse> {
  const ws = await requireWorkspace();
  if (ws instanceof NextResponse) return ws;
  if (ws.workspaceRole === "collaborator" || (owner && ws.workspaceRole !== "owner"))
    return NextResponse.json({ error: "Only the studio's owner can see its business side" }, { status: 403 });
  return ws;
}

/** Turns known problems into readable answers; anything else is a real error. */
export async function handled(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof BusinessError) return NextResponse.json({ error: err.message }, { status: err.status });
    if (err instanceof z.ZodError) return NextResponse.json({ error: z.prettifyError(err) }, { status: 400 });
    throw err;
  }
}

export async function projectIdOf(ws: WorkspaceContext, slug: string | null | undefined): Promise<string | null> {
  if (!slug) return null;
  const [row] = await ws.db.query<{ id: string }>("SELECT id FROM projects WHERE workspace_id = $1 AND slug = $2", [ws.workspaceId, slug]);
  if (!row) throw new BusinessError("Project not found", 404);
  return row.id;
}
