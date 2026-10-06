import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { refreshModelLists } from "@/lib/ai/model-lists";
import { requireAdmin } from "@/lib/server/workspace-context";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * The daily model list refresh (P4-08). Vercel's scheduler calls it with
 * CRON_SECRET; the Admin can run it by hand. Each provider with a saved key
 * is fetched, and its key re-checked on the way.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const authorised = secret ? req.headers.get("authorization") === `Bearer ${secret}` : false;
  if (!authorised) {
    const ctx = await requireAdmin();
    if (ctx instanceof NextResponse) return ctx;
  }
  const db = getDb();
  if (!db) return NextResponse.json({ error: "No database is configured" }, { status: 503 });
  return NextResponse.json({ refreshed: await refreshModelLists(db) });
}
