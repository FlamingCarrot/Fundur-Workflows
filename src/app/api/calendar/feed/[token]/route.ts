import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { feedOwner, listBookings } from "@/lib/planner/booking-store";
import { getPlanner } from "@/lib/planner/store";
import { feedEvents } from "@/lib/planner/feed";
import { buildIcs } from "@/lib/planner/ics";
import { listProjects } from "@/lib/projects/store";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ token: string }> };

/**
 * The calendar feed a calendar app subscribes to. The token in the address is
 * the only key, so a wrong one gets the same answer as a missing feed.
 */
export async function GET(req: Request, { params }: Params) {
  const db = getDb();
  const token = (await params).token.replace(/\.ics$/, "");
  const owner = db ? await feedOwner(db, token) : null;
  if (!db || !owner) return NextResponse.json({ error: "This calendar feed is not available" }, { status: 404 });

  const now = new Date();
  const [projects, { state }, bookings] = await Promise.all([
    listProjects(db, owner.workspaceId),
    getPlanner(db, owner.workspaceId, owner.userId),
    listBookings(db, owner.workspaceId, owner.userId, new Date(now.getTime() - 60 * 86_400_000), new Date(now.getTime() + 366 * 86_400_000)),
  ]);
  const origin = new URL(req.url).origin;
  const body = buildIcs("Fundur", feedEvents(projects, state, bookings, origin, now));
  return new NextResponse(body, {
    headers: {
      "content-type": "text/calendar; charset=utf-8",
      "content-disposition": 'inline; filename="fundur.ics"',
      "cache-control": "private, max-age=300",
      "referrer-policy": "no-referrer",
    },
  });
}
