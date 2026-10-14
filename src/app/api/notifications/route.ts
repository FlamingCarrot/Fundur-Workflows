import { NextResponse } from "next/server";
import { z } from "zod";
import { requireWorkspace } from "@/lib/server/workspace-context";
import { deliverDue, listNotifications, markNotificationsRead } from "@/lib/comms/store";
export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "private, no-store" };

/** This person's notifications in the workspace: mentions, replies, meetings and notes. */
export async function GET() {
  const ctx = await requireWorkspace();
  if (ctx instanceof NextResponse) return ctx;
  // Posts written for later and reminders go out as people look in.
  await deliverDue(ctx.db, ctx.workspaceId).catch((err) => console.error("Delivering due posts failed", err instanceof Error ? err.message : "unknown"));
  return NextResponse.json(await listNotifications(ctx.db, ctx.workspaceId, ctx.user.id), { headers: NO_STORE });
}

/** Marks notifications read: the ids given, or all of them. */
export async function POST(req: Request) {
  const ctx = await requireWorkspace();
  if (ctx instanceof NextResponse) return ctx;
  const input = z.object({ ids: z.array(z.uuid()).max(200).optional() }).strict().safeParse(await req.json().catch(() => ({})));
  if (!input.success) return NextResponse.json({ error: "Nothing to mark" }, { status: 400 });
  await markNotificationsRead(ctx.db, ctx.workspaceId, ctx.user.id, input.data.ids);
  return NextResponse.json(await listNotifications(ctx.db, ctx.workspaceId, ctx.user.id), { headers: NO_STORE });
}
