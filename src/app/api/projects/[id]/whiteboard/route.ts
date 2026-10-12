import { NextResponse } from "next/server";
import { requireProject } from "@/lib/server/workspace-context";
import { applyWhiteboardOp, listNotes } from "@/lib/team/store";
import { whiteboardOpSchema } from "@/lib/team/space";
import { authorOf, readJson, teamFailure, teamJson } from "@/lib/team/http";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Context) {
  const { id } = await params;
  const ctx = await requireProject(id, "project:view", undefined, "team");
  if (ctx instanceof NextResponse) return ctx;
  try {
    return teamJson({ notes: await listNotes(ctx.db, ctx.workspaceId, id) });
  } catch (e) {
    return teamFailure(e);
  }
}

/** One change to one note: put (add or replace) or remove. */
export async function POST(req: Request, { params }: Context) {
  const { id } = await params;
  const ctx = await requireProject(id, "project:edit", undefined, "team");
  if (ctx instanceof NextResponse) return ctx;
  const input = whiteboardOpSchema.safeParse(await readJson(req));
  if (!input.success) return teamJson({ error: input.error.issues[0].message }, 400);
  try {
    await applyWhiteboardOp(ctx.db, ctx.workspaceId, id, authorOf(ctx).name, input.data);
    return teamJson({ ok: true });
  } catch (e) {
    return teamFailure(e);
  }
}
