import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/server/workspace-context";
import { callSettingsInput, readCallSettings, saveCallSettings } from "@/lib/comms/calls";
export const dynamic = "force-dynamic";

/** How calls are carried, recorded and transcribed. Secrets are never sent back. */
export async function GET() {
  const ctx = await requireAdmin();
  if (ctx instanceof NextResponse) return ctx;
  return NextResponse.json(await readCallSettings(ctx.db));
}

export async function PUT(req: Request) {
  const ctx = await requireAdmin();
  if (ctx instanceof NextResponse) return ctx;
  const parsed = callSettingsInput.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Check the details" }, { status: 400 });
  try {
    return NextResponse.json(await saveCallSettings(ctx.db, parsed.data, ctx.user.id));
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
