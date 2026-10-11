import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { listAccounts, listCodes, readBillingSettings, saveBillingSettings } from "@/lib/billing/store";
import { requireAdmin } from "@/lib/server/workspace-context";

export const dynamic = "force-dynamic";

/** Every account with its plan and usage, the codes, and the platform's billing switches. */
export async function GET(req: NextRequest) {
  const ctx = await requireAdmin();
  if (ctx instanceof NextResponse) return ctx;
  const query = req.nextUrl.searchParams.get("q") ?? undefined;
  const [accounts, codes, settings] = await Promise.all([
    listAccounts(ctx.db, { query }),
    listCodes(ctx.db),
    readBillingSettings(ctx.db),
  ]);
  return NextResponse.json({ accounts, codes, settings });
}

const settingsInput = z.object({ betaAllPaid: z.boolean() }).strict();

/** Turns the free beta on or off. */
export async function PATCH(req: NextRequest) {
  const ctx = await requireAdmin();
  if (ctx instanceof NextResponse) return ctx;
  const parsed = settingsInput.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  return NextResponse.json({ settings: await saveBillingSettings(ctx.db, parsed.data, ctx.user.id) });
}
