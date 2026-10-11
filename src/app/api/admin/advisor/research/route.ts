import { NextRequest, NextResponse } from "next/server";
import { addResearch, researchInput } from "@/lib/analytics/advisor";
import { requireAdmin } from "@/lib/server/workspace-context";

export const dynamic = "force-dynamic";

/** Saves a customer or competitor note for the advisor to read. */
export async function POST(req: NextRequest) {
  const ctx = await requireAdmin();
  if (ctx instanceof NextResponse) return ctx;
  const parsed = researchInput.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "A note needs a kind, a title and some text" }, { status: 400 });
  return NextResponse.json({ note: await addResearch(ctx.db, ctx.user.id, parsed.data) });
}
