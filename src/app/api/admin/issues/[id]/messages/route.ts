import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { replyToTicket } from "@/lib/issues/store";
import { requireAdmin } from "@/lib/server/workspace-context";

export const dynamic = "force-dynamic";

const reply = z.object({ body: z.string().trim().min(1).max(10_000) }).strict();

/** The Admin answers a support request. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAdmin();
  if (ctx instanceof NextResponse) return ctx;
  const { id } = await params;
  const parsed = reply.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Write a reply first" }, { status: 400 });
  const ticket = z.uuid().safeParse(id).success ? await replyToTicket(ctx.db, ctx.user.id, id, parsed.data.body) : null;
  if (!ticket) return NextResponse.json({ error: "Request not found, or closed by the person who asked" }, { status: 404 });
  return NextResponse.json({ ticket }, { status: 201 });
}
