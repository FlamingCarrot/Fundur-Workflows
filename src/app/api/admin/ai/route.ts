import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { PROVIDER_IDS } from "@/lib/ai/providers";
import { addEnabledModel, clearRoleModel, MODEL_ROLES, readAiSettings, readRoleModels, saveRoleModel } from "@/lib/ai/settings";
import { requireAdmin } from "@/lib/server/workspace-context";
import { findModel } from "./find-model";

export const dynamic = "force-dynamic";

/** Which provider keys are saved (never the keys), the shortlist and the model in each role. */
export async function GET() {
  const ctx = await requireAdmin();
  if (ctx instanceof NextResponse) return ctx;
  return NextResponse.json(await readAiSettings(ctx.db));
}

const price = z.number().min(0).max(10_000);
const roleInput = z.object({
  // Left out, it sets the orchestrator, which every AI feature used before roles.
  role: z.enum(MODEL_ROLES).default("orchestrator"),
  provider: z.enum(PROVIDER_IDS),
  model: z.string().trim().min(1).max(255),
  inputUsdPerMTok: price,
  outputUsdPerMTok: price,
  zarPerUsd: z.number().positive().max(1_000),
  imageUsdPerImage: z.number().positive().max(100).nullable().optional(),
});

/**
 * Puts a model in a role (P4-09). It must be one the saved key for that
 * provider can use. Roles are read on every call, so the next call uses it.
 */
export async function PUT(req: NextRequest) {
  const ctx = await requireAdmin();
  if (ctx instanceof NextResponse) return ctx;
  const parsed = roleInput.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  const { role, ...setting } = parsed.data;

  // A role's model comes from the shortlist; one picked from elsewhere joins it.
  const option = await findModel(ctx.db, setting.provider, setting.model);
  if (option instanceof NextResponse) return option;
  const imageRole = role === "image" || role === "image_fallback";
  if (imageRole && (setting.provider !== "openrouter" || !option.outputs?.includes("image") || !option.inputs?.includes("image") || !setting.imageUsdPerImage)) return NextResponse.json({error:"Choose an OpenRouter model with image input/output and enter an estimated US$ price per image."},{status:400});
  if (!imageRole && option.outputs && !option.outputs.includes("text")) return NextResponse.json({error:"Choose a text-output model for this role."},{status:400});
  await addEnabledModel(ctx.db, setting.provider, option, ctx.user.id);
  if (role !== "orchestrator" && !(await readRoleModels(ctx.db)).orchestrator) {
    return NextResponse.json({ error: "Choose the top model first" }, { status: 400 });
  }
  await saveRoleModel(ctx.db, role, setting, ctx.user.id);
  return NextResponse.json(await readAiSettings(ctx.db));
}

/** Empties a role other than the top model's. */
export async function DELETE(req: NextRequest) {
  const ctx = await requireAdmin();
  if (ctx instanceof NextResponse) return ctx;
  const role = req.nextUrl.searchParams.get("role");
  if (role === "orchestrator") return NextResponse.json({ error: "The top model can be replaced but not removed" }, { status: 400 });
  if (role !== "orchestrator_fallback" && role !== "worker" && role !== "worker_fallback" && role !== "image" && role !== "image_fallback") {
    return NextResponse.json({ error: "Unknown role" }, { status: 400 });
  }
  await clearRoleModel(ctx.db, role);
  return NextResponse.json(await readAiSettings(ctx.db));
}
