import { NextRequest, NextResponse } from "next/server";
import { newProjectInput } from "@/lib/projects/mutations";
import { createProject, listProjects, MutationError } from "@/lib/projects/store";
import { requireWorkspace } from "@/lib/server/workspace-context";
import { assertCanCreateProject, limitResponse, PlanLimitError } from "@/lib/billing/guard";

export const dynamic = "force-dynamic";

/** The signed-in person's projects. */
export async function GET() {
  const ctx = await requireWorkspace();
  if (ctx instanceof NextResponse) return ctx;
  return NextResponse.json({ projects: await listProjects(ctx.db, ctx.workspaceId) });
}

/** Starts a project. */
export async function POST(req: NextRequest) {
  const ctx = await requireWorkspace();
  if (ctx instanceof NextResponse) return ctx;
  const parsed = newProjectInput.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  try {
    await assertCanCreateProject(ctx, parsed.data.workflowId);
    const project = await createProject(ctx.db, ctx.workspaceId, parsed.data);
    return NextResponse.json({ project }, { status: 201 });
  } catch (err) {
    if (err instanceof PlanLimitError) return limitResponse(err);
    if (err instanceof MutationError) return NextResponse.json({ error: err.message }, { status: 400 });
    throw err;
  }
}
