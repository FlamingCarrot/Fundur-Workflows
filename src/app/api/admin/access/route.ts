import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { saveAccess } from "@/lib/admin/users";
import { requireAdmin } from "@/lib/server/workspace-context";

export const dynamic = "force-dynamic";

const access = z.object({ inviteOnly: z.boolean() }).strict();

/** Who may sign up: anyone, or invited people only. */
export async function PUT(req: NextRequest) {
  const ctx = await requireAdmin();
  if (ctx instanceof NextResponse) return ctx;
  const parsed = access.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  return NextResponse.json({ access: await saveAccess(ctx.db, ctx.user.id, parsed.data) });
}
