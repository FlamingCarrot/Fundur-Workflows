import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { updateMyIssue } from "@/lib/issues/store";
import { requireWorkspace } from "@/lib/server/workspace-context";

export const dynamic = "force-dynamic";

const change = z.union([
  z.object({ note: z.string().trim().min(1).max(5_000) }).strict(),
  z.object({ close: z.literal(true) }).strict(),
]);

/** Edits the note of, or closes, one of the signed-in person's own reports. */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireWorkspace();
  if (ctx instanceof NextResponse) return ctx;
  const { id } = await params;
  const parsed = change.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  const issue = z.uuid().safeParse(id).success
    ? await updateMyIssue(ctx.db, ctx.workspaceId, ctx.user.id, id, parsed.data)
    : null;
  if (!issue) return NextResponse.json({ error: "Report not found" }, { status: 404 });
  return NextResponse.json({ issue });
}
