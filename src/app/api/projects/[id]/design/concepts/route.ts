import { NextResponse } from "next/server";
import { requireProject, requireFeature } from "@/lib/server/workspace-context";
import { getProject, projectDbId } from "@/lib/projects/store";
import { getWorkflow } from "@/lib/workflow";
import { getPlanState } from "@/lib/plan/store";
import {
  isInProject,
  isStorageConfigured,
  readFileBytes,
} from "@/lib/storage/blob";
import { conceptInputSchema } from "@/lib/concepts/schema";
import { normalizeImage } from "@/lib/concepts/provider";
import { rasterPlan } from "@/lib/concepts/reference";
import { imageChoices, generateConcepts } from "@/lib/concepts/generate";
import { listConcepts, ConceptBusyError } from "@/lib/concepts/store";
import { AiNotConfiguredError } from "@/lib/ai/runs";
import { AiBudgetError } from "@/lib/ai/budget";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;
const json = (body: unknown, status = 200) =>
  NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const ctx = await requireProject(id, "ai:use", "ai");
  if (ctx instanceof NextResponse) return ctx;
  const disabled = requireFeature(ctx, "design");
  if (disabled) return disabled;
  const projectId = await projectDbId(ctx.db, ctx.workspaceId, id);
  if (!projectId) return json({ error: "Project not found" }, 404);
  const choices = await imageChoices(ctx.db),
    plan = ctx.features.floor_plan
      ? await getPlanState(ctx.db, ctx.workspaceId, id)
      : null;
  return json({
    project: await getProject(ctx.db, ctx.workspaceId, id),
    generations: await listConcepts(ctx.db, ctx.workspaceId, projectId),
    configured: choices.length > 0 && isStorageConfigured(),
    estimatedZarPerImage: choices.length
      ? Math.max(...choices.map((c) => c.imageUsdPerImage! * c.zarPerUsd))
      : null,
    levels: plan?.plan?.levels.map((l) => ({ id: l.id, name: l.name })) ?? [],
    hasPlan: !!plan?.plan,
  });
}
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const ctx = await requireProject(id, "ai:use", "ai");
  if (ctx instanceof NextResponse) return ctx;
  const disabled = requireFeature(ctx, "design");
  if (disabled) return disabled;
  const raw = await req.text();
  if (raw.length > 5000)
    return json(
      { error: "Keep the design direction under 2000 characters." },
      400,
    );
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return json({ error: "Enter a design direction." }, 400);
  }
  const parsed = conceptInputSchema.safeParse(body);
  if (!parsed.success)
    return json({ error: parsed.error.issues[0].message }, 400);
  const project = await getProject(ctx.db, ctx.workspaceId, id),
    projectId = await projectDbId(ctx.db, ctx.workspaceId, id);
  if (!project || !projectId) return json({ error: "Project not found" }, 404);
  const input = parsed.data;
  const phase = getWorkflow(project).phases.find((p) =>
    p.modules.includes(`canvas_board:${input.boardKey}`),
  );
  if (!phase) return json({ error: "Choose a board in this workflow." }, 400);
  if (!isStorageConfigured())
    return json(
      {
        error:
          "Private file storage must be connected before generating images.",
      },
      503,
    );
  try {
    let reference: string, source: unknown;
    if (input.referenceDocumentId) {
      const [doc] = await ctx.db.query<{
        file_location: string;
        name: string;
        version_number: number;
      }>(
        "SELECT file_location,name,version_number FROM documents WHERE workspace_id=$1 AND project_id=$2 AND id=$3",
        [ctx.workspaceId, projectId, input.referenceDocumentId],
      );
      if (
        !doc ||
        !isInProject(doc.file_location, ctx.workspaceId, projectId) ||
        !/\.(png|jpe?g|webp)$/i.test(doc.name)
      )
        return json(
          { error: "Choose a saved project PNG, JPEG or WebP reference." },
          400,
        );
      const bytes = await readFileBytes(doc.file_location, 10 * 1024 * 1024);
      if (!bytes)
        return json(
          { error: "The reference image is unavailable or exceeds 10 MB." },
          400,
        );
      const extension = /\.png$/i.test(doc.name)
        ? "png"
        : /\.webp$/i.test(doc.name)
          ? "webp"
          : "jpeg";
      const normalized = await normalizeImage(
        `data:image/${extension};base64,${Buffer.from(bytes).toString("base64")}`,
      );
      reference = `data:image/png;base64,${Buffer.from(normalized).toString("base64")}`;
      source = {
        documentId: input.referenceDocumentId,
        documentVersion: doc.version_number,
        levelName: "Project reference image",
        brief: Object.fromEntries(
          Object.entries(project.brief).filter(
            ([k]) => !project.briefAiFields.includes(k),
          ),
        ),
      };
    } else {
      const denied = requireFeature(ctx, "floor_plan");
      if (denied) return denied;
      const plan = await getPlanState(ctx.db, ctx.workspaceId, id);
      const level = plan?.plan?.levels.find((l) => l.id === input.levelId);
      if (!plan?.plan || !level)
        return json(
          { error: "Choose a saved floor plan or reference image." },
          400,
        );
      reference = await rasterPlan(plan.plan, level.id);
      source = {
        planRevision: plan.revision,
        levelId: level.id,
        levelName: level.name,
        brief: Object.fromEntries(
          Object.entries(project.brief).filter(
            ([k]) => !project.briefAiFields.includes(k),
          ),
        ),
      };
    }
    await generateConcepts(
      ctx.db,
      {
        workspaceId: ctx.workspaceId,
        projectId,
        userId: ctx.user.id,
        task: "concept_visual",
        phaseKey: phase.key,
      },
      project,
      input,
      reference,
      source,
    );
    return json({
      generations: await listConcepts(ctx.db, ctx.workspaceId, projectId),
      project: await getProject(ctx.db, ctx.workspaceId, id),
    });
  } catch (e) {
    if (e instanceof AiNotConfiguredError)
      return json({ error: e.message }, 503);
    if (e instanceof AiBudgetError) return json({ error: e.message }, 402);
    if (e instanceof ConceptBusyError) return json({ error: e.message }, 409);
    console.error(
      "Concept generation failed",
      e instanceof Error ? e.name : "unknown",
    );
    return json(
      {
        error:
          "The concept request could not be completed. Check its saved history before retrying.",
      },
      502,
    );
  }
}
