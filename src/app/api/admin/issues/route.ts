import { NextResponse } from "next/server";
import { listTickets } from "@/lib/issues/store";
import { requireAdmin } from "@/lib/server/workspace-context";

export const dynamic = "force-dynamic";

/** Every report on the platform, as tickets for the Admin. */
export async function GET() {
  const ctx = await requireAdmin();
  if (ctx instanceof NextResponse) return ctx;
  return NextResponse.json({ tickets: await listTickets(ctx.db) });
}
