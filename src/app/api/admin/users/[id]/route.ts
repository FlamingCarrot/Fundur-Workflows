import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { updateUser, UserAdminError } from "@/lib/admin/users";
import { requireAdmin } from "@/lib/server/workspace-context";

export const dynamic = "force-dynamic";

const change = z
  .object({
    role: z.enum(["admin", "user"]).optional(),
    status: z.enum(["active", "disabled"]).optional(),
  })
  .strict()
  .refine((c) => c.role !== undefined || c.status !== undefined, "Nothing to change");

/** Changes someone's role, lets a waiting person in, or switches someone off or back on. */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAdmin();
  if (ctx instanceof NextResponse) return ctx;
  const { id } = await params;
  const parsed = change.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  try {
    return NextResponse.json({ user: await updateUser(ctx.db, ctx.user.id, decodeURIComponent(id), parsed.data) });
  } catch (err) {
    if (err instanceof UserAdminError) return NextResponse.json({ error: err.message }, { status: err.status });
    throw err;
  }
}
