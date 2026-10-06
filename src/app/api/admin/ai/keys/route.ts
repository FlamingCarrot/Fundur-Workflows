import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { PROVIDER_IDS, listModels, ProviderError, ProviderKeyError, isProviderId } from "@/lib/ai/providers";
import { deleteProviderKey, forgetModelList, readAiSettings, saveProviderKey, storeModelList } from "@/lib/ai/settings";
import { requireAdmin } from "@/lib/server/workspace-context";

export const dynamic = "force-dynamic";

const keyInput = z.object({
  provider: z.enum(PROVIDER_IDS),
  key: z.string().trim().min(8).max(500),
});

/**
 * Checks a key with its provider and saves it, encrypted, only if it works.
 * The response lists the models the key can use; the key is never sent back.
 */
export async function PUT(req: NextRequest) {
  const ctx = await requireAdmin();
  if (ctx instanceof NextResponse) return ctx;
  const parsed = keyInput.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Paste the whole key" }, { status: 400 });
  const { provider, key } = parsed.data;
  try {
    const models = await listModels(provider, key);
    await saveProviderKey(ctx.db, provider, key, ctx.user.id);
    await storeModelList(ctx.db, provider, models);
    return NextResponse.json({ ...(await readAiSettings(ctx.db)), models });
  } catch (err) {
    if (err instanceof ProviderKeyError) return NextResponse.json({ error: err.message }, { status: 400 });
    if (err instanceof ProviderError) return NextResponse.json({ error: err.message }, { status: 502 });
    throw err;
  }
}

/** Removes a provider's key. */
export async function DELETE(req: NextRequest) {
  const ctx = await requireAdmin();
  if (ctx instanceof NextResponse) return ctx;
  const provider = req.nextUrl.searchParams.get("provider");
  if (!isProviderId(provider)) return NextResponse.json({ error: "Unknown provider" }, { status: 400 });
  await deleteProviderKey(ctx.db, provider);
  await forgetModelList(ctx.db, provider);
  return NextResponse.json(await readAiSettings(ctx.db));
}
