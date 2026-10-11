import { NextRequest, NextResponse } from "next/server";
import { versionLabel } from "@/lib/plan/schema";
import { createPlanVersion, PlanNotFoundError } from "@/lib/plan/store";
import { requireProject } from "@/lib/server/workspace-context";

export const dynamic = "force-dynamic";

/** Keeps the saved plan under a name. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireProject((await params).id, "project:edit", "floor_plan");
  if (ctx instanceof NextResponse) return ctx;
  const parsed = versionLabel.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Give the version a name" }, { status: 400 });
  try {
    const version = await createPlanVersion(ctx.db, ctx.workspaceId, ctx.user.id, (await params).id, parsed.data.label);
    return NextResponse.json({ version }, { status: 201 });
  } catch (err) {
    if (err instanceof PlanNotFoundError) return NextResponse.json({ error: err.message }, { status: 404 });
    throw err;
  }
}
