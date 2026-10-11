import { NextResponse } from "next/server";
import { hasFeed, removeFeed, resetFeed } from "@/lib/planner/booking-store";
import { requireWorkspace } from "@/lib/server/workspace-context";

export const dynamic = "force-dynamic";

/** Whether the signed-in person has a calendar feed address. */
export async function GET() {
  const ctx = await requireWorkspace();
  if (ctx instanceof NextResponse) return ctx;
  return NextResponse.json({ active: await hasFeed(ctx.db, ctx.workspaceId, ctx.user.id) });
}

/** A new feed address; any earlier one stops working. The token is only ever returned here. */
export async function POST() {
  const ctx = await requireWorkspace();
  if (ctx instanceof NextResponse) return ctx;
  const token = await resetFeed(ctx.db, ctx.workspaceId, ctx.user.id);
  return NextResponse.json({ token }, { status: 201 });
}

/** Turns the feed off. */
export async function DELETE() {
  const ctx = await requireWorkspace();
  if (ctx instanceof NextResponse) return ctx;
  await removeFeed(ctx.db, ctx.workspaceId, ctx.user.id);
  return NextResponse.json({ ok: true });
}
