import { NextRequest, NextResponse } from "next/server";
import { usageOverview } from "@/lib/analytics/store";
import { requireAdmin } from "@/lib/server/workspace-context";

export const dynamic = "force-dynamic";

/** Usage over the last `days`, with the period before for comparison. */
export async function GET(req: NextRequest) {
  const ctx = await requireAdmin();
  if (ctx instanceof NextResponse) return ctx;
  const q = req.nextUrl.searchParams;
  const days = Number(q.get("days") ?? 30);
  return NextResponse.json(
    await usageOverview(ctx.db, { days: Number.isFinite(days) ? days : 30, includeAdmin: q.get("admin") === "1" })
  );
}
