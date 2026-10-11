import { NextResponse } from "next/server";
import { z } from "zod";
import { requireProject, requireFeature } from "@/lib/server/workspace-context";
import { getProject, projectDbId } from "@/lib/projects/store";
import { getDesign } from "@/lib/design/store";
import { getPlanState } from "@/lib/plan/store";
import { regulationPhase } from "@/lib/regulations/model";
import { draftRegulationFlags } from "@/lib/regulations/precheck";
import { AiNotConfiguredError } from "@/lib/ai/runs";
import { AiBudgetError } from "@/lib/ai/budget";
import { ProviderError } from "@/lib/ai/providers";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const ctx = await requireProject(id, "ai:use", "ai");
  if (ctx instanceof NextResponse) return ctx;
  const disabled = requireFeature(ctx, "design");
  if (disabled) return disabled;
  if (
    !z
      .object({})
      .strict()
      .safeParse(await req.json().catch(() => null)).success
  )
    return NextResponse.json(
      { error: "This pre-check uses saved project facts" },
      { status: 400 },
    );
  const project = await getProject(ctx.db, ctx.workspaceId, id),
    projectId = await projectDbId(ctx.db, ctx.workspaceId, id);
  if (!project || !projectId || !regulationPhase(project))
    return NextResponse.json(
      { error: "Project checklist not found" },
      { status: 404 },
    );
  try {
    const design = await getDesign(ctx.db, ctx.workspaceId, id);
    const state = ctx.features.floor_plan
      ? await getPlanState(ctx.db, ctx.workspaceId, id)
      : null;
    return NextResponse.json(
      await draftRegulationFlags(
        ctx.db,
        {
          workspaceId: ctx.workspaceId,
          projectId,
          userId: ctx.user.id,
          phaseKey: regulationPhase(project)!.key,
        },
        project,
        design.data,
        state?.plan ?? null,
      ),
    );
  } catch (e) {
    if (e instanceof AiNotConfiguredError)
      return NextResponse.json(
        {
          error:
            "No AI model is set up yet. Ask the administrator to connect one.",
        },
        { status: 503 },
      );
    if (e instanceof AiBudgetError)
      return NextResponse.json({ error: e.message }, { status: 402 });
    if (e instanceof ProviderError)
      return NextResponse.json(
        {
          error:
            "The AI provider could not complete this pre-check. Please retry.",
        },
        { status: 502 },
      );
    console.error(
      "Regulation pre-check failed",
      e instanceof Error ? e.name : "unknown",
    );
    return NextResponse.json(
      { error: "The flag list could not be completed. Please retry." },
      { status: 500 },
    );
  }
}
