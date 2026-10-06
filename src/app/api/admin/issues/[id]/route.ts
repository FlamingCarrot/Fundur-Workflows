import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { updateTicket } from "@/lib/issues/store";
import { requireAdmin } from "@/lib/server/workspace-context";

export const dynamic = "force-dynamic";

const change = z
  .object({
    status: z.enum(["open", "in_progress", "resolved"]).optional(),
    adminNote: z.string().trim().max(5_000).optional(),
  })
  .strict()
  .refine((c) => c.status !== undefined || c.adminNote !== undefined, "Nothing to change");

/** Moves a ticket along, or saves the Admin's note on it. */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAdmin();
  if (ctx instanceof NextResponse) return ctx;
  const { id } = await params;
  const parsed = change.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  const ticket = z.uuid().safeParse(id).success ? await updateTicket(ctx.db, ctx.user.id, id, parsed.data) : null;
  if (!ticket) return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
  return NextResponse.json({ ticket });
}
