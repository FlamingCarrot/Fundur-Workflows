import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { setSuggestionStatus, SUGGESTION_STATUSES } from "@/lib/analytics/advisor";
import { requireAdmin } from "@/lib/server/workspace-context";

export const dynamic = "force-dynamic";

const change = z.object({ status: z.enum(SUGGESTION_STATUSES) }).strict();

/** Starts, finishes, sets aside or reopens a suggestion. */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireAdmin();
  if (ctx instanceof NextResponse) return ctx;
  const { id } = await params;
  const parsed = change.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  const suggestion = z.uuid().safeParse(id).success ? await setSuggestionStatus(ctx.db, id, parsed.data.status) : null;
  if (!suggestion) return NextResponse.json({ error: "Suggestion not found" }, { status: 404 });
  return NextResponse.json({ suggestion });
}
