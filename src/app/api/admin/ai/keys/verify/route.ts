import { NextRequest, NextResponse } from "next/server";
import { aiSettingsView } from "@/lib/ai/auto-models";
import { fetchAndStore } from "@/lib/ai/model-lists";
import { isProviderId } from "@/lib/ai/providers";
import { readProviderKey, recordKeyCheck } from "@/lib/ai/settings";
import { requireAdmin } from "@/lib/server/workspace-context";

export const dynamic = "force-dynamic";

/** Checks a saved key again with its provider (P4-07) and refreshes its model list while at it. */
export async function POST(req: NextRequest) {
  const ctx = await requireAdmin();
  if (ctx instanceof NextResponse) return ctx;
  const { provider } = ((await req.json().catch(() => null)) ?? {}) as { provider?: unknown };
  if (!isProviderId(provider)) return NextResponse.json({ error: "Unknown provider" }, { status: 400 });
  try {
    const key = await readProviderKey(ctx.db, provider);
    if (!key) {
      const errorMsg = "The saved key could not be decrypted or is missing. Please enter it again.";
      await recordKeyCheck(ctx.db, provider, errorMsg);
      return NextResponse.json({ ...(await aiSettingsView(ctx.db)), error: errorMsg });
    }
    const models = await fetchAndStore(ctx.db, provider, key);
    return NextResponse.json({ ...(await aiSettingsView(ctx.db)), models });
  } catch (err) {
    // A failed check is recorded on the card; the response carries the settings with it.
    const message = (err as Error).message || "Provider key check failed";
    await recordKeyCheck(ctx.db, provider, message);
    return NextResponse.json({ ...(await aiSettingsView(ctx.db)), error: message });
  }
}
