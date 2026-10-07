import { NextResponse } from "next/server";
import { z } from "zod";
import { requireProject } from "@/lib/server/workspace-context";
import { internalComments } from "@/lib/sharing/store";
import { commentInput } from "@/lib/sharing/schema";
import { shareJson, shareFailure } from "@/lib/sharing/http";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string; shareId: string }> };
export async function GET(_req: Request, { params }: Context) {
  const { id, shareId } = await params;
  const ctx = await requireProject(id, "document:share", "sharing");
  if (ctx instanceof NextResponse) return ctx;
  if (!z.uuid().safeParse(shareId).success)
    return shareJson({ error: "Link not found" }, 404);
  try {
    return shareJson({
      comments: await internalComments(ctx.db, ctx.workspaceId, id, shareId),
    });
  } catch (e) {
    return shareFailure(e);
  }
}
export async function POST(req: Request, { params }: Context) {
  const { id, shareId } = await params;
  const ctx = await requireProject(id, "document:share", "sharing");
  if (ctx instanceof NextResponse) return ctx;
  if (!z.uuid().safeParse(shareId).success)
    return shareJson({ error: "Link not found" }, 404);
  const raw = await req.json().catch(() => null);
  const input = commentInput.safeParse({
    ...raw,
    authorName: ctx.user.name || "Studio",
  });
  if (!input.success)
    return shareJson({ error: input.error.issues[0].message }, 400);
  try {
    return shareJson(
      {
        comment: await internalComments(
          ctx.db,
          ctx.workspaceId,
          id,
          shareId,
          input.data,
        ),
      },
      201,
    );
  } catch (e) {
    return shareFailure(e);
  }
}
