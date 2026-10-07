import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { BillingError, redeemCode } from "@/lib/billing/store";
import { requireWorkspace } from "@/lib/server/workspace-context";

export const dynamic = "force-dynamic";

const input = z.object({ code: z.string().trim().min(1).max(60) }).strict();

/** Uses a code from the Admin: free months of Paid, or a discount. */
export async function POST(req: NextRequest) {
  const ctx = await requireWorkspace();
  if (ctx instanceof NextResponse) return ctx;
  const parsed = input.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Enter a code" }, { status: 400 });
  try {
    const { summary } = await redeemCode(ctx.db, ctx.workspaceId, parsed.data.code, ctx.user.id);
    return NextResponse.json({ summary });
  } catch (err) {
    if (err instanceof BillingError) return NextResponse.json({ error: err.message }, { status: 400 });
    throw err;
  }
}
