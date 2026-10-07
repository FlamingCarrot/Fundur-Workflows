import { NextResponse } from "next/server";
import { z } from "zod";
import { requireProject, requireFeature } from "@/lib/server/workspace-context";
import { getDesign } from "@/lib/design/store";
import { draftSpecification } from "@/lib/design/specification";
import { getProject, projectDbId } from "@/lib/projects/store";
import { getWorkflow } from "@/lib/workflow";
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
  const parsed = z
    .object({ itemId: z.uuid() })
    .strict()
    .safeParse(await req.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json({ error: "Choose a saved item" }, { status: 400 });
  const state = await getDesign(ctx.db, ctx.workspaceId, id),
    item = state.data.items.find((i) => i.id === parsed.data.itemId);
  if (!item)
    return NextResponse.json(
      { error: "Save this selection before drafting a specification" },
      { status: 404 },
    );
  const project = await getProject(ctx.db, ctx.workspaceId, id),
    projectId = await projectDbId(ctx.db, ctx.workspaceId, id);
  if (!project || !projectId)
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  try {
    return NextResponse.json(
      await draftSpecification(
        ctx.db,
        {
          workspaceId: ctx.workspaceId,
          projectId,
          userId: ctx.user.id,
          phaseKey: getWorkflow(project).phases.find((p) =>
            p.modules.includes("item_register:schedule"),
          )?.key,
        },
        item,
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
          error: "The AI provider could not complete this draft. Please retry.",
        },
        { status: 502 },
      );
    console.error(
      "Specification drafting failed",
      e instanceof Error ? e.name : "unknown",
    );
    return NextResponse.json(
      {
        error: "The specification draft could not be completed. Please retry.",
      },
      { status: 500 },
    );
  }
}
