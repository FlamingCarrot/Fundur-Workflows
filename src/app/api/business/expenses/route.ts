import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { addExpense, listExpenses } from "@/lib/business/store";
import { handled, projectIdOf, requireBusiness } from "@/lib/business/http";

export const dynamic = "force-dynamic";

/** Expenses to recharge: her own (the owner sees everyone's), or one project's. */
export async function GET(req: NextRequest) {
  const ws = await requireBusiness(false);
  if (ws instanceof NextResponse) return ws;
  return handled(async () => {
    const projectId = await projectIdOf(ws, req.nextUrl.searchParams.get("project"));
    const all = ws.workspaceRole === "owner";
    return NextResponse.json({ expenses: await listExpenses(ws.db, ws.workspaceId, { userId: all ? undefined : ws.user.id, projectId: projectId ?? undefined }) });
  });
}

const body = z.object({ project: z.string().max(100).nullable().default(null) }).passthrough();

export async function POST(req: NextRequest) {
  const ws = await requireBusiness(false);
  if (ws instanceof NextResponse) return ws;
  return handled(async () => {
    const raw = await req.json().catch(() => null);
    const b = body.parse(raw);
    return NextResponse.json({ expense: await addExpense(ws.db, ws.workspaceId, ws.user.id, await projectIdOf(ws, b.project), raw) });
  });
}
