import { NextResponse } from "next/server";
import { z } from "zod";
import { deleteResearch } from "@/lib/analytics/advisor";
import { requireAdmin } from "@/lib/server/workspace-context";

export const dynamic = "force-dynamic";

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAdmin();
  if (ctx instanceof NextResponse) return ctx;
  const { id } = await params;
  const gone = z.uuid().safeParse(id).success && (await deleteResearch(ctx.db, id));
  if (!gone) return NextResponse.json({ error: "Note not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
