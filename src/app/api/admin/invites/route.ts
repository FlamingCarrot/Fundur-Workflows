import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createInvite, UserAdminError } from "@/lib/admin/users";
import { requireAdmin } from "@/lib/server/workspace-context";

export const dynamic = "force-dynamic";

const newInvite = z.object({
  email: z.email().max(255),
  name: z.string().trim().max(255).optional(),
  role: z.enum(["admin", "user"]).default("user"),
});

/** Invites someone by email; the reply carries the link to send them. */
export async function POST(req: NextRequest) {
  const ctx = await requireAdmin();
  if (ctx instanceof NextResponse) return ctx;
  const parsed = newInvite.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Enter a valid email address" }, { status: 400 });
  try {
    return NextResponse.json({ invite: await createInvite(ctx.db, ctx.user.id, parsed.data) }, { status: 201 });
  } catch (err) {
    if (err instanceof UserAdminError) return NextResponse.json({ error: err.message }, { status: err.status });
    throw err;
  }
}
