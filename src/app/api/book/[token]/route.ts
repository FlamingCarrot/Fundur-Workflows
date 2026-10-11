import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { bookingRequest } from "@/lib/planner/booking";
import { book, BookingError, publicLink } from "@/lib/planner/booking-store";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ token: string }> };

const NO_STORE = { "cache-control": "no-store", "referrer-policy": "no-referrer" };

function failed(err: unknown) {
  if (err instanceof BookingError) return NextResponse.json({ error: err.message }, { status: err.status, headers: NO_STORE });
  throw err;
}

/** A booking link as a client sees it: the meeting and the times on offer. No sign-in; the token is the key. */
export async function GET(_req: NextRequest, { params }: Params) {
  const db = getDb();
  if (!db) return NextResponse.json({ error: "This booking link is not available" }, { status: 404, headers: NO_STORE });
  try {
    return NextResponse.json(await publicLink(db, (await params).token), { headers: NO_STORE });
  } catch (err) {
    return failed(err);
  }
}

/** Books one of the times on offer. */
export async function POST(req: NextRequest, { params }: Params) {
  const db = getDb();
  if (!db) return NextResponse.json({ error: "This booking link is not available" }, { status: 404, headers: NO_STORE });
  const parsed = bookingRequest.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Check the details" }, { status: 400, headers: NO_STORE });
  try {
    const booked = await book(db, (await params).token, parsed.data);
    // The client gets their meeting back, not the owner's other details.
    return NextResponse.json({ booking: { title: booked.title, start: booked.start, end: booked.end } }, { status: 201, headers: NO_STORE });
  } catch (err) {
    return failed(err);
  }
}
