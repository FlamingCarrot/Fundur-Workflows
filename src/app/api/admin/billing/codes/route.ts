import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { BillingError, createCode } from "@/lib/billing/store";
import { requireAdmin } from "@/lib/server/workspace-context";

export const dynamic = "force-dynamic";

const input = z
  .object({
    code: z.string().trim().min(3).max(40),
    kind: z.enum(["free_months", "percent", "amount"]),
    value: z.number().positive().max(10_000),
    months: z.number().int().min(1).max(120).nullable().optional(),
    maxRedemptions: z.number().int().min(1).max(100_000).nullable().optional(),
    expiresAt: z.iso.date().nullable().optional(),
    note: z.string().trim().max(500).nullable().optional(),
  })
  .strict()
  .refine((c) => c.kind !== "percent" || c.value <= 100, "A percent discount is at most 100")
  .refine((c) => c.kind !== "free_months" || Number.isInteger(c.value), "Free months are whole months");

/** A new code for free months or a discount. */
export async function POST(req: NextRequest) {
  const ctx = await requireAdmin();
  if (ctx instanceof NextResponse) return ctx;
  const parsed = input.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "That code isn't valid" }, { status: 400 });
  try {
    const expiresAt = parsed.data.expiresAt ? `${parsed.data.expiresAt}T23:59:59Z` : null;
    const code = await createCode(ctx.db, { ...parsed.data, expiresAt }, ctx.user.id);
    return NextResponse.json({ code }, { status: 201 });
  } catch (err) {
    if (err instanceof BillingError) return NextResponse.json({ error: err.message }, { status: 400 });
    throw err;
  }
}
