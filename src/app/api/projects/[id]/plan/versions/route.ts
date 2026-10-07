import { NextRequest, NextResponse } from "next/server";
import { versionLabel } from "@/lib/plan/schema";
import { createPlanVersion, PlanNotFoundError } from "@/lib/plan/store";
import { requireWorkspace } from "@/lib/server/workspace-context";
import { limitResponse, PlanLimitError } from "@/lib/billing/guard";
import { assertPlanVersionAllowed } from "@/lib/plan/limits";

export const dynamic = "force-dynamic";

/** Keeps the saved plan under a name. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireWorkspace();
  if (ctx instanceof NextResponse) return ctx;
  const parsed = versionLabel.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Give the version a name" }, { status: 400 });
  try {
    const slug = (await params).id;
    await assertPlanVersionAllowed(ctx, slug);
    const version = await createPlanVersion(ctx.db, ctx.workspaceId, ctx.user.id, slug, parsed.data.label);
    return NextResponse.json({ version }, { status: 201 });
  } catch (err) {
    if (err instanceof PlanLimitError) return limitResponse(err);
    if (err instanceof PlanNotFoundError) return NextResponse.json({ error: err.message }, { status: 404 });
    throw err;
  }
}
