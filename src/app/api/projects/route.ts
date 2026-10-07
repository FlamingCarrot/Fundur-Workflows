import { NextRequest, NextResponse } from "next/server";
import { newProjectInput } from "@/lib/projects/mutations";
import { createProject, listProjects, MutationError } from "@/lib/projects/store";
import { requireWorkspace, requirePermission, accessibleProjectSlugs } from "@/lib/server/workspace-context";

export const dynamic = "force-dynamic";

/** The signed-in person's projects. */
export async function GET() {
  const ctx = await requireWorkspace();
  if (ctx instanceof NextResponse) return ctx;
  const allowed = await accessibleProjectSlugs(ctx);
  const projects = (await listProjects(ctx.db, ctx.workspaceId)).filter(p => allowed === null || allowed.includes(p.id));
  return NextResponse.json({ projects: projects.map(p => ctx.workspaceRole === "collaborator" ? { ...p, aiSpendZar: 0, briefCostZar: undefined } : p) });
}

/** Starts a project. */
export async function POST(req: NextRequest) {
  const ctx = await requireWorkspace();
  if (ctx instanceof NextResponse) return ctx;
  const denied = requirePermission(ctx, "project:create");
  if (denied) return denied;
  const parsed = newProjectInput.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  try {
    const project = await createProject(ctx.db, ctx.workspaceId, parsed.data);
    return NextResponse.json({ project }, { status: 201 });
  } catch (err) {
    if (err instanceof MutationError) return NextResponse.json({ error: err.message }, { status: 400 });
    throw err;
  }
}
