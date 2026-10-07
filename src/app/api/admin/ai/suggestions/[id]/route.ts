import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { readAiSettings } from "@/lib/ai/settings";
import { acceptSuggestion, dismissSuggestion, listSuggestions, SuggestionGoneError } from "@/lib/ai/suggestions";
import { requireAdmin } from "@/lib/server/workspace-context";

export const dynamic = "force-dynamic";

const input = z.object({ action: z.enum(["accept", "dismiss"]) });

/** Accepts a suggestion (the role switches to the model) or dismisses it. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAdmin();
  if (ctx instanceof NextResponse) return ctx;
  const { id } = await params;
  const parsed = input.safeParse(await req.json().catch(() => null));
  if (!parsed.success || !z.uuid().safeParse(id).success) return NextResponse.json({ error: "Say accept or dismiss" }, { status: 400 });
  try {
    if (parsed.data.action === "accept") await acceptSuggestion(ctx.db, id, ctx.user.id);
    else await dismissSuggestion(ctx.db, id, ctx.user.id);
  } catch (err) {
    if (!(err instanceof SuggestionGoneError)) throw err;
    return NextResponse.json({ error: err.message, suggestions: await listSuggestions(ctx.db) }, { status: 409 });
  }
  return NextResponse.json({ suggestions: await listSuggestions(ctx.db), settings: await readAiSettings(ctx.db) });
}
