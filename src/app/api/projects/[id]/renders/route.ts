import { NextResponse } from "next/server";
import { z } from "zod";
import { requireFeature, requireProject } from "@/lib/server/workspace-context";
import { getProject, projectDbId } from "@/lib/projects/store";
import { imageChoices } from "@/lib/concepts/generate";
import { aiRender, RENDER_PRESETS } from "@/lib/renders/ai-render";
import { AiNotConfiguredError } from "@/lib/ai/runs";
import { AiBudgetError } from "@/lib/ai/budget";
import { ProviderError, ProviderKeyError } from "@/lib/ai/providers";
import { isStorageConfigured } from "@/lib/storage/blob";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });

const input = z.object({
  direction: z.string().trim().min(1).max(2_000),
  image: z.string().max(12_000_000).regex(/^data:image\/(png|jpeg|webp);base64,/),
  viewName: z.string().trim().min(1).max(120),
});

/** Whether AI renders are set up here, and what one is estimated to cost. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireProject(id, "ai:use", "ai");
  if (ctx instanceof NextResponse) return ctx;
  const denied = requireFeature(ctx, "floor_plan");
  if (denied) return denied;
  const choices = await imageChoices(ctx.db);
  return json({
    configured: choices.length > 0,
    storage: isStorageConfigured(),
    estimatedZarPerImage: choices.length ? Math.max(...choices.map((c) => c.imageUsdPerImage! * c.zarPerUsd)) : null,
    presets: RENDER_PRESETS,
  });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireProject(id, "ai:use", "ai");
  if (ctx instanceof NextResponse) return ctx;
  const denied = requireFeature(ctx, "floor_plan");
  if (denied) return denied;
  const parsed = input.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json({ error: "Describe the look you want, and render from a 3D view." }, 400);
  const project = await getProject(ctx.db, ctx.workspaceId, id);
  const projectId = await projectDbId(ctx.db, ctx.workspaceId, id);
  if (!project || !projectId) return json({ error: "Project not found" }, 404);
  try {
    const result = await aiRender(ctx.db, { workspaceId: ctx.workspaceId, projectId, userId: ctx.user.id, task: "ai_render" }, project, parsed.data);
    return json({ ...result, ...(ctx.user.platformRole === "admin" ? {} : { costZar: undefined }) });
  } catch (e) {
    if (e instanceof AiNotConfiguredError) return json({ error: e.message }, 503);
    if (e instanceof AiBudgetError) return json({ error: e.message }, 402);
    if (e instanceof ProviderKeyError) return json({ error: "The image provider did not accept its saved key. Ask the administrator to check it." }, 502);
    if (e instanceof ProviderError) return json({ error: e.message || "The image model could not finish this render." }, 502);
    console.error("AI render failed", e instanceof Error ? e.name : "unknown");
    return json({ error: "The render could not be finished. Try again in a moment." }, 502);
  }
}
