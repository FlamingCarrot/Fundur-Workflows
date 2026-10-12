import { NextResponse } from "next/server";
import { z } from "zod";
import { requireProject } from "@/lib/server/workspace-context";
import { listMessages, postMessage } from "@/lib/team/store";
import { newMessageSchema } from "@/lib/team/space";
import { authorOf, readJson, teamFailure, teamJson } from "@/lib/team/http";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string; chatId: string }> };
const chatId = z.uuid();

export async function GET(_req: Request, { params }: Context) {
  const { id, chatId: raw } = await params;
  const ctx = await requireProject(id, "project:view", undefined, "team");
  if (ctx instanceof NextResponse) return ctx;
  if (!chatId.safeParse(raw).success) return teamJson({ error: "Chat not found" }, 404);
  try {
    return teamJson({ messages: await listMessages(ctx.db, ctx.workspaceId, id, raw, ctx.user.id) });
  } catch (e) {
    return teamFailure(e);
  }
}

export async function POST(req: Request, { params }: Context) {
  const { id, chatId: raw } = await params;
  const ctx = await requireProject(id, "project:view", undefined, "team");
  if (ctx instanceof NextResponse) return ctx;
  const input = newMessageSchema.safeParse(await readJson(req));
  if (!input.success || !chatId.safeParse(raw).success) return teamJson({ error: "Write a message first" }, 400);
  try {
    return teamJson({ message: await postMessage(ctx.db, ctx.workspaceId, id, raw, authorOf(ctx), input.data.body) }, 201);
  } catch (e) {
    return teamFailure(e);
  }
}
