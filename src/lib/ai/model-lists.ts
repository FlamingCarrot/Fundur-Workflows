import type { Db } from "@/lib/db";
import { listModels, ProviderError, ProviderKeyError, PROVIDER_IDS, type ModelOption, type ProviderId } from "./providers";
import { MODEL_LIST_MAX_AGE_MS, readProviderKey, readStoredModelList, recordKeyCheck, storeModelList } from "./settings";

/**
 * Each provider's model list, fetched once a day on a schedule (P4-08) and
 * kept, so the model browser opens without waiting on the provider. Every
 * fetch also re-checks the saved key, so a key that stops working shows on
 * its card the next morning rather than when a designer next asks for help.
 */

export async function fetchAndStore(db: Db, provider: ProviderId, key: string, fetchImpl?: typeof fetch): Promise<ModelOption[]> {
  try {
    const models = await listModels(provider, key, fetchImpl);
    await storeModelList(db, provider, models);
    await recordKeyCheck(db, provider, null);
    return models;
  } catch (err) {
    if (err instanceof ProviderKeyError) await recordKeyCheck(db, provider, err.message);
    throw err;
  }
}

/** The stored list while it is fresh, else a new one from the provider. */
export async function modelList(db: Db, provider: ProviderId, key: string, fetchImpl?: typeof fetch): Promise<ModelOption[]> {
  const stored = await readStoredModelList(db, provider);
  if (stored && Date.now() - new Date(stored.fetchedAt).getTime() < MODEL_LIST_MAX_AGE_MS) return stored.models;
  return fetchAndStore(db, provider, key, fetchImpl);
}

export interface RefreshResult {
  provider: ProviderId;
  models?: number;
  error?: string;
}

/** Refreshes every provider that has a saved key. */
export async function refreshModelLists(db: Db, fetchImpl?: typeof fetch): Promise<RefreshResult[]> {
  const results: RefreshResult[] = [];
  for (const provider of PROVIDER_IDS) {
    const key = await readProviderKey(db, provider);
    if (!key) continue;
    try {
      results.push({ provider, models: (await fetchAndStore(db, provider, key, fetchImpl)).length });
    } catch (err) {
      if (!(err instanceof ProviderError) && !(err instanceof ProviderKeyError)) throw err;
      results.push({ provider, error: (err as Error).message });
    }
  }
  return results;
}
