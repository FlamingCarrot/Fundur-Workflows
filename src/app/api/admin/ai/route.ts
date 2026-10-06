import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { PROVIDER_IDS } from "@/lib/ai/providers";
import { addEnabledModel, readAiSettings, saveDefaultModel } from "@/lib/ai/settings";
import { requireAdmin } from "@/lib/server/workspace-context";
import { findModel } from "./find-model";

export const dynamic = "force-dynamic";

/** Which provider keys are saved (never the keys), the shortlist and the default model. */
export async function GET() {
  const ctx = await requireAdmin();
  if (ctx instanceof NextResponse) return ctx;
  return NextResponse.json(await readAiSettings(ctx.db));
}

const price = z.number().min(0).max(10_000);
const defaultModelInput = z.object({
  provider: z.enum(PROVIDER_IDS),
  model: z.string().trim().min(1).max(255),
  inputUsdPerMTok: price,
  outputUsdPerMTok: price,
  zarPerUsd: z.number().positive().max(1_000),
});

/** Sets the default model. It must be one the saved key for that provider can use. */
export async function PUT(req: NextRequest) {
  const ctx = await requireAdmin();
  if (ctx instanceof NextResponse) return ctx;
  const parsed = defaultModelInput.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  const setting = parsed.data;

  // The default comes from the shortlist; one picked from elsewhere joins it.
  const option = await findModel(ctx.db, setting.provider, setting.model);
  if (option instanceof NextResponse) return option;
  await addEnabledModel(ctx.db, setting.provider, option, ctx.user.id);
  await saveDefaultModel(ctx.db, setting, ctx.user.id);
  return NextResponse.json(await readAiSettings(ctx.db));
}
