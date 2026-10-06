import { NextResponse } from "next/server";
import { listSuggestions } from "@/lib/ai/suggestions";
import { requireAdmin } from "@/lib/server/workspace-context";

export const dynamic = "force-dynamic";

/** Models the daily list suggests for a role (P4-17), waiting on the Admin. */
export async function GET() {
  const ctx = await requireAdmin();
  if (ctx instanceof NextResponse) return ctx;
  return NextResponse.json({ suggestions: await listSuggestions(ctx.db) });
}
