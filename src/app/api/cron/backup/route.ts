import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { runBackup } from "@/lib/backup/run";
import { requireAdmin } from "@/lib/server/workspace-context";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * The daily backup (P1-16). Vercel's scheduler calls this once a day with
 * CRON_SECRET; the Admin can also run it by hand to check it works.
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

  const result = await runBackup(db);
  // A missing file means storage lost something; it is reported, not hidden in a success.
  return NextResponse.json(result, { status: !result.path ? 503 : result.missingFiles.length ? 500 : 200 });
}
