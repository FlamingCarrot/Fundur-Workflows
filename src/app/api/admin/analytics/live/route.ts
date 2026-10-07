import { NextRequest, NextResponse } from "next/server";
import { liveView } from "@/lib/analytics/store";
import { requireAdmin } from "@/lib/server/workspace-context";

export const dynamic = "force-dynamic";

/** Who is in the app right now, and what has happened since `after`. */
export async function GET(req: NextRequest) {
  const ctx = await requireAdmin();
  if (ctx instanceof NextResponse) return ctx;
  const q = req.nextUrl.searchParams;
  const after = Number(q.get("after") ?? 0);
  return NextResponse.json(
    await liveView(ctx.db, { afterId: Number.isFinite(after) ? after : 0, includeAdmin: q.get("admin") === "1" })
  );
}
