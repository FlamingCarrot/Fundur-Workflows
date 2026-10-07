import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { changeMySupport } from "@/lib/support/store";
import { requireWorkspace } from "@/lib/server/workspace-context";

export const dynamic = "force-dynamic";

const change = z.union([
  z.object({ reply: z.string().trim().min(1).max(10_000) }).strict(),
  z.object({ close: z.literal(true) }).strict(),
  z.object({ seen: z.literal(true) }).strict(),
]);

/** The person replies on their request, closes it, or marks the Admin's replies read. */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireWorkspace();
  if (ctx instanceof NextResponse) return ctx;
  const { id } = await params;
  const parsed = change.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  const request = z.uuid().safeParse(id).success ? await changeMySupport(ctx.db, ctx.user.id, id, parsed.data) : null;
  if (!request) return NextResponse.json({ error: "Request not found" }, { status: 404 });
  return NextResponse.json({ request });
}
