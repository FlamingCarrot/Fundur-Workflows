import { NextRequest, NextResponse } from "next/server";
import { deleteExpense, getExpense } from "@/lib/business/store";
import { handled, requireBusiness } from "@/lib/business/http";

export const dynamic = "force-dynamic";

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ expenseId: string }> }) {
  const ws = await requireBusiness(false);
  if (ws instanceof NextResponse) return ws;
  const { expenseId } = await ctx.params;
  return handled(async () => {
    const e = await getExpense(ws.db, ws.workspaceId, expenseId);
    if (!e || (e.userId !== ws.user.id && ws.workspaceRole !== "owner")) return NextResponse.json({ error: "Not found" }, { status: 404 });
    await deleteExpense(ws.db, ws.workspaceId, expenseId);
    return NextResponse.json({ ok: true });
  });
}
