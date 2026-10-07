import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { PlanConflictError, PlanNotFoundError, restorePlanVersion } from "@/lib/plan/store";
import { requireProject } from "@/lib/server/workspace-context";

export const dynamic = "force-dynamic";

const body = z.object({ baseRevision: z.number().int().min(1) });

/** Puts a version back as the plan; the plan as it stood is kept as a version first. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string; versionId: string }> }) {
  const ctx = await requireProject((await params).id, "project:edit", "floor_plan");
  if (ctx instanceof NextResponse) return ctx;
  const { id, versionId } = await params;
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success || !z.uuid().safeParse(versionId).success) {
    return NextResponse.json({ error: "Bad restore request" }, { status: 400 });
  }
  try {
    const state = await restorePlanVersion(ctx.db, ctx.workspaceId, ctx.user.id, id, versionId, parsed.data.baseRevision);
    return NextResponse.json(state);
  } catch (err) {
    if (err instanceof PlanConflictError) return NextResponse.json({ error: err.message, current: err.current }, { status: 409 });
    if (err instanceof PlanNotFoundError) return NextResponse.json({ error: err.message }, { status: 404 });
    throw err;
  }
}
