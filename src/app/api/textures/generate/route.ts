import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/lib/server/workspace-context";
import { libraryContext, noStore } from "../../library/context";
import { aiTexture } from "@/lib/textures/ai";
import { imageChoices } from "@/lib/concepts/generate";
import { AiNotConfiguredError } from "@/lib/ai/runs";
import { ProviderError, ProviderKeyError } from "@/lib/ai/providers";
import { MATERIAL_CATEGORIES } from "@/lib/blueprints/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

const input = z.object({
  description: z.string().trim().min(3).max(600),
  name: z.string().trim().min(1).max(120),
  category: z.enum(MATERIAL_CATEGORIES),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  tile: z.number().finite().min(50).max(20_000),
});

async function context() {
  const ctx = await libraryContext(true);
  if (ctx instanceof NextResponse) return ctx;
  if (!ctx.features.ai) return NextResponse.json({ error: "AI is not enabled for your account." }, { status: 403, headers: noStore });
  return requirePermission(ctx, "ai:use") ?? ctx;
}

/** Whether AI textures can be made here, and about what one costs. */
export async function GET() {
  const ctx = await context();
  if (ctx instanceof NextResponse) return ctx;
  const choices = await imageChoices(ctx.db);
  return NextResponse.json({ configured: choices.length > 0, estimatedZarPerImage: choices.length ? Math.max(...choices.map((c) => c.imageUsdPerImage! * c.zarPerUsd)) : null }, { headers: noStore });
}

export async function POST(req: Request) {
  const ctx = await context();
  if (ctx instanceof NextResponse) return ctx;
  const parsed = input.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Describe the material in a few words." }, { status: 400, headers: noStore });
  try {
    const { costZar, ...material } = await aiTexture(ctx.db, { workspaceId: ctx.workspaceId, projectId: null, userId: ctx.user.id }, parsed.data);
    return NextResponse.json({ material, ...(ctx.user.platformRole === "admin" ? { costZar } : {}) }, { headers: noStore });
  } catch (e) {
    if (e instanceof AiNotConfiguredError) return NextResponse.json({ error: e.message }, { status: 503, headers: noStore });
    if (e instanceof ProviderKeyError) return NextResponse.json({ error: "The image provider did not accept its saved key. Ask the administrator to check it." }, { status: 502, headers: noStore });
    if (e instanceof ProviderError) return NextResponse.json({ error: e.message || "The image model could not make this texture." }, { status: 502, headers: noStore });
    console.error("AI texture failed", e instanceof Error ? e.name : "unknown");
    return NextResponse.json({ error: "The texture could not be made. Try again in a moment." }, { status: 502, headers: noStore });
  }
}
