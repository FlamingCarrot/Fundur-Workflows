import { NextResponse } from "next/server";
import { requireWorkspace } from "@/lib/server/workspace-context";
import { myStatus, setMyStatus } from "@/lib/comms/status";
import { myStatusSchema } from "@/lib/comms/types";
export const dynamic = "force-dynamic";
const NO_STORE = { "Cache-Control": "private, no-store" };

/** The status this person set (busy or away, a note, until when). */
export async function GET() {
  const ctx = await requireWorkspace();
  if (ctx instanceof NextResponse) return ctx;
  return NextResponse.json(await myStatus(ctx.db, ctx.workspaceId, ctx.user.id), { headers: NO_STORE });
}

/** Sets this person's status, or clears it (manual null) to go back to automatic. */
export async function POST(req: Request) {
  const ctx = await requireWorkspace();
  if (ctx instanceof NextResponse) return ctx;
  const input = myStatusSchema.safeParse(await req.json().catch(() => null));
  if (!input.success) return NextResponse.json({ error: "Pick busy, away or automatic" }, { status: 400 });
  await setMyStatus(ctx.db, ctx.workspaceId, ctx.user.id, input.data);
  return NextResponse.json(await myStatus(ctx.db, ctx.workspaceId, ctx.user.id), { headers: NO_STORE });
}
