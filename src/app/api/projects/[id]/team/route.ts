import { NextResponse } from "next/server";
import { z } from "zod";
import { requireProject } from "@/lib/server/workspace-context";
import { projectTeam, setMemberAccess } from "@/lib/team/store";
import { projectAccessSchema } from "@/lib/team/access";
import { readJson, teamFailure, teamJson } from "@/lib/team/http";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };

/** Everyone on the project and what each may see and do. */
export async function GET(_req: Request, { params }: Context) {
  const { id } = await params;
  const ctx = await requireProject(id, "project:view");
  if (ctx instanceof NextResponse) return ctx;
  try {
    const members = await projectTeam(ctx.db, ctx.workspaceId, id);
    // Only owners see how each teammate's access is set.
    return teamJson({ members: ctx.workspaceRole === "owner" ? members : members.map((m) => ({ ...m, access: null })) });
  } catch (e) {
    return teamFailure(e);
  }
}

const putInput = z.object({ userId: z.string().min(1).max(255), access: projectAccessSchema.nullable() }).strict();

/** The owner sets one teammate's access; null gives full access back. */
export async function PUT(req: Request, { params }: Context) {
  const { id } = await params;
  const ctx = await requireProject(id, "project:edit");
  if (ctx instanceof NextResponse) return ctx;
  if (ctx.workspaceRole !== "owner") return teamJson({ error: "Only an owner can change who sees what" }, 403);
  const input = putInput.safeParse(await readJson(req));
  if (!input.success) return teamJson({ error: input.error.issues[0].message }, 400);
  try {
    await setMemberAccess(ctx.db, ctx.workspaceId, id, ctx.user.id, input.data.userId, input.data.access);
    return teamJson({ members: await projectTeam(ctx.db, ctx.workspaceId, id) });
  } catch (e) {
    return teamFailure(e);
  }
}
