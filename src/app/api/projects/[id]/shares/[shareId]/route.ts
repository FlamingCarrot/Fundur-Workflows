import { NextResponse } from "next/server";
import { z } from "zod";
import { requireProject } from "@/lib/server/workspace-context";
import { revokeShare } from "@/lib/sharing/store";
import { shareJson, shareFailure } from "@/lib/sharing/http";
export const dynamic = "force-dynamic";
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; shareId: string }> },
) {
  const { id, shareId } = await params;
  const ctx = await requireProject(id, "document:share", "sharing");
  if (ctx instanceof NextResponse) return ctx;
  if (!z.uuid().safeParse(shareId).success)
    return shareJson({ error: "Link not found" }, 404);
  try {
    await revokeShare(ctx.db, ctx.workspaceId, id, shareId);
    return shareJson({ ok: true });
  } catch (e) {
    return shareFailure(e);
  }
}
