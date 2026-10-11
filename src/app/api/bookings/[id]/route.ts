import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { cancelBooking } from "@/lib/planner/booking-store";
import { requireWorkspace } from "@/lib/server/workspace-context";

export const dynamic = "force-dynamic";

/** Cancels a booked meeting; its time opens again on the link. */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireWorkspace();
  if (ctx instanceof NextResponse) return ctx;
  const id = (await params).id;
  if (!z.uuid().safeParse(id).success) return NextResponse.json({ error: "That meeting no longer exists" }, { status: 404 });
  await cancelBooking(ctx.db, ctx.workspaceId, ctx.user.id, id);
  return NextResponse.json({ ok: true });
}
