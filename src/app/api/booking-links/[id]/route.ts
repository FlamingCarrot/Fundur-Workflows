import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { BookingError, deleteLink, setLinkActive } from "@/lib/planner/booking-store";
import { requireWorkspace } from "@/lib/server/workspace-context";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** Turns a link on or off. */
export async function PATCH(req: NextRequest, { params }: Params) {
  const ctx = await requireWorkspace();
  if (ctx instanceof NextResponse) return ctx;
  const id = (await params).id;
  const parsed = z.object({ active: z.boolean() }).safeParse(await req.json().catch(() => null));
  if (!parsed.success || !z.uuid().safeParse(id).success) return NextResponse.json({ error: "That change is not valid" }, { status: 400 });
  try {
    return NextResponse.json({ link: await setLinkActive(ctx.db, ctx.workspaceId, ctx.user.id, id, parsed.data.active) });
  } catch (err) {
    if (err instanceof BookingError) return NextResponse.json({ error: err.message }, { status: err.status });
    throw err;
  }
}

/** Deletes a link; meetings already booked through it stay. */
export async function DELETE(_req: NextRequest, { params }: Params) {
  const ctx = await requireWorkspace();
  if (ctx instanceof NextResponse) return ctx;
  const id = (await params).id;
  if (!z.uuid().safeParse(id).success) return NextResponse.json({ error: "That link no longer exists" }, { status: 404 });
  await deleteLink(ctx.db, ctx.workspaceId, ctx.user.id, id);
  return NextResponse.json({ ok: true });
}
