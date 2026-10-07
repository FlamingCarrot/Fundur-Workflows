import { NextResponse } from "next/server";
import { z } from "zod";
import { revokeInvite } from "@/lib/admin/users";
import { requireAdmin } from "@/lib/server/workspace-context";

export const dynamic = "force-dynamic";

/** Stops an invite link working. */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAdmin();
  if (ctx instanceof NextResponse) return ctx;
  const { id } = await params;
  const done = z.uuid().safeParse(id).success && (await revokeInvite(ctx.db, id));
  if (!done) return NextResponse.json({ error: "Invite not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
