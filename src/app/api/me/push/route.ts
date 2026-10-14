import { NextResponse } from "next/server";
import { z } from "zod";
import { requireWorkspace } from "@/lib/server/workspace-context";
import { pushSubscriptionSchema, removePushSubscription, savePushSubscription, vapidKeys } from "@/lib/comms/push";
export const dynamic = "force-dynamic";

/** The server's public push key, for a device to subscribe with. */
export async function GET() {
  const ctx = await requireWorkspace();
  if (ctx instanceof NextResponse) return ctx;
  return NextResponse.json({ publicKey: (await vapidKeys(ctx.db)).publicKey }, { headers: { "Cache-Control": "private, no-store" } });
}

/** Keeps this device, so notifications reach it as pushes. */
export async function POST(req: Request) {
  const ctx = await requireWorkspace();
  if (ctx instanceof NextResponse) return ctx;
  const sub = pushSubscriptionSchema.safeParse(await req.json().catch(() => null));
  if (!sub.success) return NextResponse.json({ error: "That device could not be added" }, { status: 400 });
  await savePushSubscription(ctx.db, ctx.user.id, sub.data);
  return NextResponse.json({ ok: true });
}

/** Stops pushes to this device. */
export async function DELETE(req: Request) {
  const ctx = await requireWorkspace();
  if (ctx instanceof NextResponse) return ctx;
  const input = z.object({ endpoint: z.string().max(1000) }).safeParse(await req.json().catch(() => null));
  if (!input.success) return NextResponse.json({ error: "Which device?" }, { status: 400 });
  await removePushSubscription(ctx.db, ctx.user.id, input.data.endpoint);
  return NextResponse.json({ ok: true });
}
