import { NextResponse } from "next/server";
import { requireProject } from "@/lib/server/workspace-context";
import { createChat, listChats } from "@/lib/team/store";
import { newChatSchema } from "@/lib/team/space";
import { readJson, teamFailure, teamJson } from "@/lib/team/http";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };

/** The chats this person is in: everyone's, and group chats they were added to. */
export async function GET(_req: Request, { params }: Context) {
  const { id } = await params;
  const ctx = await requireProject(id, "project:view", undefined, "team");
  if (ctx instanceof NextResponse) return ctx;
  try {
    return teamJson({ chats: await listChats(ctx.db, ctx.workspaceId, id, ctx.user.id) });
  } catch (e) {
    return teamFailure(e);
  }
}

export async function POST(req: Request, { params }: Context) {
  const { id } = await params;
  const ctx = await requireProject(id, "project:view", undefined, "team");
  if (ctx instanceof NextResponse) return ctx;
  const input = newChatSchema.safeParse(await readJson(req));
  if (!input.success) return teamJson({ error: input.error.issues[0].message }, 400);
  try {
    return teamJson({ chat: await createChat(ctx.db, ctx.workspaceId, id, ctx.user.id, input.data) }, 201);
  } catch (e) {
    return teamFailure(e);
  }
}
