import { NextRequest, NextResponse } from "next/server";
import { fetchAndStore } from "@/lib/ai/model-lists";
import { isProviderId, ProviderError, ProviderKeyError } from "@/lib/ai/providers";
import { readAiSettings, readProviderKey, recordKeyCheck } from "@/lib/ai/settings";
import { requireAdmin } from "@/lib/server/workspace-context";

export const dynamic = "force-dynamic";

/** Checks a saved key again with its provider (P4-07) and refreshes its model list while at it. */
export async function POST(req: NextRequest) {
  const ctx = await requireAdmin();
  if (ctx instanceof NextResponse) return ctx;
  const { provider } = ((await req.json().catch(() => null)) ?? {}) as { provider?: unknown };
  if (!isProviderId(provider)) return NextResponse.json({ error: "Unknown provider" }, { status: 400 });
  const key = await readProviderKey(ctx.db, provider);
  if (!key) return NextResponse.json({ error: "No key saved for this provider" }, { status: 404 });
  try {
    const models = await fetchAndStore(ctx.db, provider, key);
    return NextResponse.json({ ...(await readAiSettings(ctx.db)), models });
  } catch (err) {
    // A failed check is recorded on the card; the response carries the settings with it.
    if (err instanceof ProviderError && !(err instanceof ProviderKeyError)) await recordKeyCheck(ctx.db, provider, err.message);
    if (err instanceof ProviderKeyError || err instanceof ProviderError) {
      return NextResponse.json({ ...(await readAiSettings(ctx.db)), error: err.message });
    }
    throw err;
  }
}
