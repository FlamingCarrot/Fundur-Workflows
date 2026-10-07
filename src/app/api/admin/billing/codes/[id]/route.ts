import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { setCodeActive } from "@/lib/billing/store";
import { requireAdmin } from "@/lib/server/workspace-context";

export const dynamic = "force-dynamic";

/** Switches a code off (or back on). */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAdmin();
  if (ctx instanceof NextResponse) return ctx;
  const { id } = await params;
  const parsed = z.object({ active: z.boolean() }).strict().safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  const ok = z.uuid().safeParse(id).success && (await setCodeActive(ctx.db, id, parsed.data.active));
  if (!ok) return NextResponse.json({ error: "Code not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
