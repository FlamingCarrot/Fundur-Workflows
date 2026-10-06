import { NextRequest, NextResponse } from "next/server";
import { dismissAlert } from "@/lib/ai/budget";
import { requireWorkspace } from "@/lib/server/workspace-context";

export const dynamic = "force-dynamic";

/** Dismisses a budget alert once it has been seen. */
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string; alertId: string }> }) {
  const ws = await requireWorkspace();
  if (ws instanceof NextResponse) return ws;
  const { alertId } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(alertId) || !(await dismissAlert(ws.db, ws.workspaceId, alertId))) {
    return NextResponse.json({ error: "No such alert" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
