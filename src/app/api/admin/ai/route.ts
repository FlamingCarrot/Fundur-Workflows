import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { PROVIDER_IDS, listModels, ProviderError, ProviderKeyError } from "@/lib/ai/providers";
import { readAiSettings, readProviderKey, saveDefaultModel } from "@/lib/ai/settings";
import { requireAdmin } from "@/lib/server/workspace-context";

export const dynamic = "force-dynamic";

/** Which provider keys are saved (never the keys) and the default model. */
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

  const key = await readProviderKey(ctx.db, setting.provider);
  if (!key) return NextResponse.json({ error: "Save a key for this provider first" }, { status: 400 });
  try {
    const models = await listModels(setting.provider, key);
    if (!models.some((m) => m.id === setting.model)) {
      return NextResponse.json({ error: `This key cannot use '${setting.model}'` }, { status: 400 });
    }
  } catch (err) {
    if (err instanceof ProviderKeyError) {
      return NextResponse.json({ error: "The saved key no longer works. Enter it again." }, { status: 400 });
    }
    if (err instanceof ProviderError) return NextResponse.json({ error: err.message }, { status: 502 });
    throw err;
  }
  await saveDefaultModel(ctx.db, setting, ctx.user.id);
  return NextResponse.json(await readAiSettings(ctx.db));
}
