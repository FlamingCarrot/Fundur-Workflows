import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/server/workspace-context";
import { getPlatformByokPolicy, setPlatformByokPolicy } from "@/lib/ai/settings";

export const dynamic = "force-dynamic";

export async function GET() {
  const ctx = await requireAdmin();
  if (ctx instanceof NextResponse) return ctx;

  const policy = await getPlatformByokPolicy(ctx.db);
  return NextResponse.json(policy);
}

const patchSchema = z.object({
  byokAllowed: z.boolean(),
});

export async function PATCH(req: NextRequest) {
  const ctx = await requireAdmin();
  if (ctx instanceof NextResponse) return ctx;

  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid policy format" }, { status: 400 });
  }

  await setPlatformByokPolicy(ctx.db, parsed.data.byokAllowed);
  const policy = await getPlatformByokPolicy(ctx.db);
  return NextResponse.json(policy);
}
