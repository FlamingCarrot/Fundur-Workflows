import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { setViewMode } from "@/lib/auth/users";
import { requireAdmin } from "@/lib/server/workspace-context";

export const dynamic = "force-dynamic";

const view = z.object({ mode: z.enum(["admin", "basic"]) }).strict();

/** The Admin switches between seeing everything and seeing the app as a basic user. */
export async function PUT(req: NextRequest) {
  const ctx = await requireAdmin();
  if (ctx instanceof NextResponse) return ctx;
  const parsed = view.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  await setViewMode(ctx.db, ctx.user.id, parsed.data.mode);
  return NextResponse.json({ mode: parsed.data.mode });
}
