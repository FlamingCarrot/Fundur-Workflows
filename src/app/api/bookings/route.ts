import { NextRequest, NextResponse } from "next/server";
import { listBookings } from "@/lib/planner/booking-store";
import { requireWorkspace } from "@/lib/server/workspace-context";

export const dynamic = "force-dynamic";

/** The signed-in person's booked meetings between two dates (YYYY-MM-DD, at most a year apart). */
export async function GET(req: NextRequest) {
  const ctx = await requireWorkspace();
  if (ctx instanceof NextResponse) return ctx;
  const params = req.nextUrl.searchParams;
  const from = new Date(`${params.get("from")}T00:00:00Z`);
  const to = new Date(`${params.get("to")}T00:00:00Z`);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to < from || to.getTime() - from.getTime() > 400 * 86_400_000) {
    return NextResponse.json({ error: "Give a from and to date" }, { status: 400 });
  }
  // A day either side, so meetings late or early in other time zones are not missed.
  const bookings = await listBookings(ctx.db, ctx.workspaceId, ctx.user.id, new Date(from.getTime() - 86_400_000), new Date(to.getTime() + 2 * 86_400_000));
  return NextResponse.json({ bookings });
}
