import { NextRequest, NextResponse } from "next/server";
import { heatmap } from "@/lib/analytics/store";
import type { Device } from "@/lib/analytics/events";
import { requireAdmin } from "@/lib/server/workspace-context";

export const dynamic = "force-dynamic";

const DEVICES: Device[] = ["desktop", "tablet", "phone"];

/** Where people click on one kind of page, on one kind of device. */
export async function GET(req: NextRequest) {
  const ctx = await requireAdmin();
  if (ctx instanceof NextResponse) return ctx;
  const q = req.nextUrl.searchParams;
  const days = Number(q.get("days") ?? 30);
  const device = DEVICES.find((d) => d === q.get("device")) ?? "desktop";
  return NextResponse.json(
    await heatmap(ctx.db, {
      route: q.get("route") || undefined,
      device,
      days: Number.isFinite(days) ? days : 30,
      includeAdmin: q.get("admin") === "1",
    })
  );
}
