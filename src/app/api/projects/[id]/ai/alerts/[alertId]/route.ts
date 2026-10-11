import { NextRequest, NextResponse } from "next/server";
import { dismissAlert } from "@/lib/ai/budget";
import { requireProject } from "@/lib/server/workspace-context";

export const dynamic = "force-dynamic";

/** Dismisses a budget alert once it has been seen. */
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string; alertId: string }> }) {
  const ws = await requireProject((await ctx.params).id, "ai:view_cost");
  if (ws instanceof NextResponse) return ws;
  const { id, alertId } = await ctx.params;
  const [owned] = /^[0-9a-f-]{36}$/i.test(alertId) ? await ws.db.query("SELECT a.id FROM ai_budget_alerts a JOIN projects p ON p.id=a.project_id WHERE a.id=$1 AND a.workspace_id=$2 AND p.workspace_id=$2 AND p.slug=$3", [alertId, ws.workspaceId, id]) : [];
  if (!owned) return NextResponse.json({error:"No such alert"}, {status:404});
  if (!/^[0-9a-f-]{36}$/i.test(alertId) || !(await dismissAlert(ws.db, ws.workspaceId, alertId))) {
    return NextResponse.json({ error: "No such alert" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
