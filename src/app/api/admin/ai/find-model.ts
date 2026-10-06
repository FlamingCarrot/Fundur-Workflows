import { NextResponse } from "next/server";
import { listModelsCached, ProviderError, ProviderKeyError, type ModelOption, type ProviderId } from "@/lib/ai/providers";
import { readProviderKey } from "@/lib/ai/settings";
import type { Db } from "@/lib/db";

/**
 * The provider's own entry for a model the saved key can use, or the response
 * to send when there is none: no key, a key that stopped working, or a model
 * the key cannot use.
 */
export async function findModel(db: Db, provider: ProviderId, model: string): Promise<ModelOption | NextResponse> {
  const key = await readProviderKey(db, provider);
  if (!key) return NextResponse.json({ error: "Save a key for this provider first" }, { status: 400 });
  try {
    const option = (await listModelsCached(provider, key)).find((m) => m.id === model);
    return option ?? NextResponse.json({ error: `This key cannot use '${model}'` }, { status: 400 });
  } catch (err) {
    if (err instanceof ProviderKeyError) {
      return NextResponse.json({ error: "The saved key no longer works. Enter it again." }, { status: 400 });
    }
    if (err instanceof ProviderError) return NextResponse.json({ error: err.message }, { status: 502 });
    throw err;
  }
}
