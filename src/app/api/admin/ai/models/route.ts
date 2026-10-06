import { NextRequest, NextResponse } from "next/server";
import { isProviderId, listModelsCached, ProviderError, ProviderKeyError } from "@/lib/ai/providers";
import { readProviderKey } from "@/lib/ai/settings";
import { requireAdmin } from "@/lib/server/workspace-context";

export const dynamic = "force-dynamic";

/** The models the saved key for a provider can use, for the model browser. */
export async function GET(req: NextRequest) {
  const ctx = await requireAdmin();
  if (ctx instanceof NextResponse) return ctx;
  const provider = req.nextUrl.searchParams.get("provider");
  if (!isProviderId(provider)) return NextResponse.json({ error: "Unknown provider" }, { status: 400 });
  const key = await readProviderKey(ctx.db, provider);
  if (!key) return NextResponse.json({ error: "No key saved for this provider" }, { status: 404 });
  try {
    return NextResponse.json({ models: await listModelsCached(provider, key) });
  } catch (err) {
    if (err instanceof ProviderKeyError) {
      return NextResponse.json({ error: "The saved key no longer works. Enter it again." }, { status: 400 });
    }
    if (err instanceof ProviderError) return NextResponse.json({ error: err.message }, { status: 502 });
    throw err;
  }
}
