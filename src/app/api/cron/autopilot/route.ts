import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { runDueAutopilots } from "@/lib/autopilot/run";
import { projectFileReader } from "@/lib/autopilot/server";
import { requireAdmin } from "@/lib/server/workspace-context";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Every autopilot that is due a look runs (a batch per call). Vercel's
 * scheduler calls it with CRON_SECRET; the Admin can run it by hand. Between
 * crons, projects are also picked up when someone opens the app.
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
  return NextResponse.json({ runs: await runDueAutopilots(db, { limit: 20, readFile: projectFileReader }) });
}
