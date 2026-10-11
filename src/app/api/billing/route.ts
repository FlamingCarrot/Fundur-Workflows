import { NextResponse } from "next/server";
import { planOf } from "@/lib/billing/guard";
import { PLANS } from "@/lib/billing/plans";
import { paymentsEnabled } from "@/lib/billing/provider";
import { readBillingSettings, readUsage } from "@/lib/billing/store";
import { requireWorkspace } from "@/lib/server/workspace-context";

export const dynamic = "force-dynamic";

/** The signed-in person's plan, what they use against it, and the plans on offer. */
export async function GET() {
  const ctx = await requireWorkspace();
  if (ctx instanceof NextResponse) return ctx;
  const [plan, usage, settings] = await Promise.all([
    planOf(ctx),
    readUsage(ctx.db, ctx.workspaceId),
    readBillingSettings(ctx.db),
  ]);
  return NextResponse.json({
    plan,
    usage,
    plans: Object.values(PLANS),
    beta: settings.betaAllPaid,
    payments: paymentsEnabled(),
  });
}
