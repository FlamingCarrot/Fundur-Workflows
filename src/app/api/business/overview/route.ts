import { NextResponse } from "next/server";
import { businessOverview } from "@/lib/business/overview";
import { handled, requireBusiness } from "@/lib/business/http";

export const dynamic = "force-dynamic";

/** The studio's money at a glance, and each project's. */
export async function GET() {
  const ws = await requireBusiness();
  if (ws instanceof NextResponse) return ws;
  return handled(async () => NextResponse.json(await businessOverview(ws.db, ws.workspaceId)));
}
