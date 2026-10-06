import { NextRequest, NextResponse } from "next/server";
import { savePlanInput } from "@/lib/plan/schema";
import { getPlanState, PlanConflictError, PlanNotFoundError, savePlan } from "@/lib/plan/store";
import { requireWorkspace } from "@/lib/server/workspace-context";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** The project's floor plan, its versions and its corrections log. */
export async function GET(_req: NextRequest, { params }: Params) {
  const ctx = await requireWorkspace();
  if (ctx instanceof NextResponse) return ctx;
  const state = await getPlanState(ctx.db, ctx.workspaceId, (await params).id);
  if (!state) return NextResponse.json({ error: "Project not found" }, { status: 404 });
  return NextResponse.json(state);
}

/** Saves the plan; 409 with the stored plan when it changed elsewhere since it was loaded. */
export async function PUT(req: NextRequest, { params }: Params) {
  const ctx = await requireWorkspace();
  if (ctx instanceof NextResponse) return ctx;
  const parsed = savePlanInput.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  try {
    const saved = await savePlan(ctx.db, ctx.workspaceId, ctx.user.id, (await params).id, parsed.data);
    return NextResponse.json(saved);
  } catch (err) {
    if (err instanceof PlanConflictError) return NextResponse.json({ error: err.message, current: err.current }, { status: 409 });
    if (err instanceof PlanNotFoundError) return NextResponse.json({ error: err.message }, { status: 404 });
    throw err;
  }
}
