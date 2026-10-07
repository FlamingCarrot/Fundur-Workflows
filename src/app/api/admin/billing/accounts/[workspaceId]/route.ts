import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { planFor, adminChange, BillingError, listEvents, readUsage, setSeats } from "@/lib/billing/store";
import { requireAdmin } from "@/lib/server/workspace-context";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ workspaceId: string }> };

const months = z.number().int().min(1).max(120);

const change = z.discriminatedUnion("type", [
  z.object({ type: z.literal("assign"), plan: z.enum(["free", "paid"]), months: months.nullable(), extraSeats: z.number().int().min(0).max(500).optional() }),
  z.object({ type: z.literal("freeMonths"), months }),
  z.object({
    type: z.literal("discount"),
    kind: z.enum(["percent", "amount"]),
    value: z.number().positive().max(10_000),
    months: months.nullable(),
    note: z.string().trim().max(500).nullable().optional(),
  }).refine((d) => d.kind !== "percent" || d.value <= 100, "A percent discount is at most 100"),
  z.object({ type: z.literal("clearDiscount") }),
  z.object({ type: z.literal("seats"), extraSeats: z.number().int().min(0).max(500) }),
]);

async function account(ctx: { db: Parameters<typeof planFor>[0] }, workspaceId: string) {
  const [plan, usage, events] = await Promise.all([
    planFor(ctx.db, workspaceId),
    readUsage(ctx.db, workspaceId),
    listEvents(ctx.db, workspaceId),
  ]);
  return { plan, usage, events };
}

/** One account's plan, usage and history. */
export async function GET(_req: NextRequest, { params }: Params) {
  const ctx = await requireAdmin();
  if (ctx instanceof NextResponse) return ctx;
  const { workspaceId } = await params;
  if (!z.uuid().safeParse(workspaceId).success) return NextResponse.json({ error: "Account not found" }, { status: 404 });
  return NextResponse.json(await account(ctx, workspaceId));
}

/** The Admin assigns a plan, gives free months, sets a discount or seats. */
export async function POST(req: NextRequest, { params }: Params) {
  const ctx = await requireAdmin();
  if (ctx instanceof NextResponse) return ctx;
  const { workspaceId } = await params;
  if (!z.uuid().safeParse(workspaceId).success) return NextResponse.json({ error: "Account not found" }, { status: 404 });
  const parsed = change.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "That change isn't valid" }, { status: 400 });
  try {
    if (parsed.data.type === "seats") await setSeats(ctx.db, workspaceId, parsed.data.extraSeats, ctx.user.id);
    else await adminChange(ctx.db, workspaceId, parsed.data, ctx.user.id);
    return NextResponse.json(await account(ctx, workspaceId));
  } catch (err) {
    if (err instanceof BillingError) return NextResponse.json({ error: err.message }, { status: 400 });
    throw err;
  }
}
