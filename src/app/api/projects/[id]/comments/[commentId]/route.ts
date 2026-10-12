import { NextResponse } from "next/server";
import { z } from "zod";
import { requireProject } from "@/lib/server/workspace-context";
import { deleteComment, resolveComment } from "@/lib/team/store";
import { commentChangeSchema } from "@/lib/team/space";
import { readJson, teamFailure, teamJson } from "@/lib/team/http";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string; commentId: string }> };
const commentId = z.uuid();

/** Resolves a comment thread, or opens it again. */
export async function PATCH(req: Request, { params }: Context) {
  const { id, commentId: raw } = await params;
  const ctx = await requireProject(id, "project:view");
  if (ctx instanceof NextResponse) return ctx;
  const input = commentChangeSchema.safeParse(await readJson(req));
  if (!input.success || !commentId.safeParse(raw).success) return teamJson({ error: "Could not read the change" }, 400);
  try {
    return teamJson({ comment: await resolveComment(ctx.db, ctx.workspaceId, id, raw, ctx.user.id, input.data.resolved) });
  } catch (e) {
    return teamFailure(e);
  }
}

export async function DELETE(_req: Request, { params }: Context) {
  const { id, commentId: raw } = await params;
  const ctx = await requireProject(id, "project:view");
  if (ctx instanceof NextResponse) return ctx;
  if (!commentId.safeParse(raw).success) return teamJson({ error: "Comment not found" }, 404);
  try {
    await deleteComment(ctx.db, ctx.workspaceId, id, raw, ctx.user.id, ctx.workspaceRole === "owner");
    return teamJson({ deleted: true });
  } catch (e) {
    return teamFailure(e);
  }
}
