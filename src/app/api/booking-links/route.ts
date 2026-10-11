import { NextRequest, NextResponse } from "next/server";
import { bookingLinkInput } from "@/lib/planner/booking";
import { createLink, listBookings, listLinks } from "@/lib/planner/booking-store";
import { requireWorkspace } from "@/lib/server/workspace-context";

export const dynamic = "force-dynamic";

/** The signed-in person's booking links, and the meetings booked from today on. */
export async function GET() {
  const ctx = await requireWorkspace();
  if (ctx instanceof NextResponse) return ctx;
  const now = new Date();
  const [links, bookings] = await Promise.all([
    listLinks(ctx.db, ctx.workspaceId, ctx.user.id),
    listBookings(ctx.db, ctx.workspaceId, ctx.user.id, new Date(now.getTime() - 86_400_000), new Date(now.getTime() + 400 * 86_400_000)),
  ]);
  return NextResponse.json({ links, bookings });
}

/** A new booking link. */
export async function POST(req: NextRequest) {
  const ctx = await requireWorkspace();
  if (ctx instanceof NextResponse) return ctx;
  const parsed = bookingLinkInput.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "That link is not valid" }, { status: 400 });
  return NextResponse.json({ link: await createLink(ctx.db, ctx.workspaceId, ctx.user.id, parsed.data) }, { status: 201 });
}
