import { NextRequest, NextResponse } from "next/server";
import { docInput } from "@/lib/business/model";
import { deleteDraft, getDoc, getSettings, updateDoc } from "@/lib/business/store";
import { handled, requireBusiness } from "@/lib/business/http";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, ctx: { params: Promise<{ docId: string }> }) {
  const ws = await requireBusiness();
  if (ws instanceof NextResponse) return ws;
  const doc = await getDoc(ws.db, ws.workspaceId, (await ctx.params).docId, req.nextUrl.origin);
  if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ doc, settings: await getSettings(ws.db, ws.workspaceId) });
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ docId: string }> }) {
  const ws = await requireBusiness();
  if (ws instanceof NextResponse) return ws;
  const { docId } = await ctx.params;
  return handled(async () => NextResponse.json({ doc: await updateDoc(ws.db, ws.workspaceId, docId, docInput.partial().parse(await req.json().catch(() => ({})))) }));
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ docId: string }> }) {
  const ws = await requireBusiness();
  if (ws instanceof NextResponse) return ws;
  const { docId } = await ctx.params;
  return handled(async () => {
    await deleteDraft(ws.db, ws.workspaceId, docId);
    return NextResponse.json({ ok: true });
  });
}
