import { NextRequest, NextResponse } from "next/server";
import { settingsInput } from "@/lib/view-settings/schema";
import { getViewSettings, saveViewSettings } from "@/lib/view-settings/store";
import { requireWorkspace } from "@/lib/server/workspace-context";

export const dynamic = "force-dynamic";

/** How the signed-in person last left each view. */
export async function GET() {
  const ctx = await requireWorkspace();
  if (ctx instanceof NextResponse) return ctx;
  return NextResponse.json({ settings: await getViewSettings(ctx.db, ctx.user.id) });
}

/** Saves the settings sent; the others stay as they are. */
export async function PUT(req: NextRequest) {
  const ctx = await requireWorkspace();
  if (ctx instanceof NextResponse) return ctx;
  const parsed = settingsInput.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Those settings are not valid" }, { status: 400 });
  await saveViewSettings(ctx.db, ctx.user.id, parsed.data.settings);
  return NextResponse.json({ ok: true });
}
