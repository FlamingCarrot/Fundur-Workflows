import { NextResponse } from "next/server";
import { requireProject } from "@/lib/server/workspace-context";
import { addComment, listComments } from "@/lib/team/store";
import { anchorSchema, newCommentSchema } from "@/lib/team/space";
import { authorOf, readJson, teamFailure, teamJson } from "@/lib/team/http";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };

/** The team's comments on the project, or on one anchor (?anchor=step:abc). */
export async function GET(req: Request, { params }: Context) {
  const { id } = await params;
  const ctx = await requireProject(id, "project:view");
  if (ctx instanceof NextResponse) return ctx;
  const raw = new URL(req.url).searchParams.get("anchor");
  const anchor = raw ? anchorSchema.safeParse(raw) : null;
  if (anchor && !anchor.success) return teamJson({ error: "Choose what the comments are about" }, 400);
  try {
    return teamJson({ comments: await listComments(ctx.db, ctx.workspaceId, id, anchor?.data) });
  } catch (e) {
    return teamFailure(e);
  }
}

/** Anyone on the project can comment, including teammates who only view it. */
export async function POST(req: Request, { params }: Context) {
  const { id } = await params;
  const ctx = await requireProject(id, "project:view");
  if (ctx instanceof NextResponse) return ctx;
  const input = newCommentSchema.safeParse(await readJson(req));
  if (!input.success) return teamJson({ error: input.error.issues[0].message }, 400);
  try {
    return teamJson({ comment: await addComment(ctx.db, ctx.workspaceId, id, authorOf(ctx), input.data) }, 201);
  } catch (e) {
    return teamFailure(e);
  }
}
