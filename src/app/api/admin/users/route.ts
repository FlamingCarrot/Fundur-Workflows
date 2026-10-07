import { NextResponse } from "next/server";
import { listInvites, listUsers, readAccess } from "@/lib/admin/users";
import { requireAdmin } from "@/lib/server/workspace-context";

export const dynamic = "force-dynamic";

/** Everyone on the platform, the invites still open, and who may sign up. */
export async function GET() {
  const ctx = await requireAdmin();
  if (ctx instanceof NextResponse) return ctx;
  const [users, invites, access] = await Promise.all([listUsers(ctx.db), listInvites(ctx.db), readAccess(ctx.db)]);
  return NextResponse.json({ users, invites, access, me: ctx.user.id });
}
