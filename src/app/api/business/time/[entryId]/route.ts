import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { BusinessError, deleteEntry, getEntry, updateEntry } from "@/lib/business/store";
import { handled, projectIdOf, requireBusiness } from "@/lib/business/http";

export const dynamic = "force-dynamic";

const patch = z.object({
  minutes: z.number().int().min(1).max(1440).optional(),
  note: z.string().max(500).optional(),
  billable: z.boolean().optional(),
  project: z.string().max(100).nullable().optional(),
  phaseKey: z.string().max(100).nullable().optional(),
});

async function mine(entryId: string) {
  const ws = await requireBusiness(false);
  if (ws instanceof NextResponse) return ws;
  const entry = await getEntry(ws.db, ws.workspaceId, entryId);
  if (!entry || (entry.userId !== ws.user.id && ws.workspaceRole !== "owner")) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return ws;
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ entryId: string }> }) {
  const { entryId } = await ctx.params;
  const ws = await mine(entryId);
  if (ws instanceof NextResponse) return ws;
  return handled(async () => {
    const p = patch.parse(await req.json().catch(() => null));
    const projectId = p.project === undefined ? undefined : await projectIdOf(ws, p.project);
    if (p.project && !projectId) throw new BusinessError("Project not found", 404);
    return NextResponse.json({ entry: await updateEntry(ws.db, ws.workspaceId, entryId, { minutes: p.minutes, note: p.note, billable: p.billable, projectId, phaseKey: p.phaseKey }) });
  });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ entryId: string }> }) {
  const { entryId } = await ctx.params;
  const ws = await mine(entryId);
  if (ws instanceof NextResponse) return ws;
  return handled(async () => {
    await deleteEntry(ws.db, ws.workspaceId, entryId);
    return NextResponse.json({ ok: true });
  });
}
