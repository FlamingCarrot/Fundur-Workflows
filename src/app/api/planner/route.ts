import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { PlannerError, plannerOp } from "@/lib/planner/state";
import { changePlanner, getPlanner } from "@/lib/planner/store";
import { requireWorkspace } from "@/lib/server/workspace-context";

export const dynamic = "force-dynamic";

/** The signed-in person's to-dos, lists, board and working week. */
export async function GET() {
  const ctx = await requireWorkspace();
  if (ctx instanceof NextResponse) return ctx;
  return NextResponse.json(await getPlanner(ctx.db, ctx.workspaceId, ctx.user.id));
}

const changeInput = z.object({ ops: z.array(plannerOp).min(1).max(50) });

/** Applies changes in order; 400 with the reason when one does not fit. */
export async function POST(req: NextRequest) {
  const ctx = await requireWorkspace();
  if (ctx instanceof NextResponse) return ctx;
  const parsed = changeInput.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "That change is not valid" }, { status: 400 });
  try {
    return NextResponse.json(await changePlanner(ctx.db, ctx.workspaceId, ctx.user.id, parsed.data.ops));
  } catch (err) {
    if (err instanceof PlannerError) return NextResponse.json({ error: err.message }, { status: 400 });
    throw err;
  }
}
