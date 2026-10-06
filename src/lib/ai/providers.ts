import Anthropic from "@anthropic-ai/sdk";
import type { ModelOption, ProviderId } from "./catalog";

export { PROVIDER_IDS, PROVIDERS, isProviderId } from "./catalog";
export type { ModelOption, ProviderId, ProviderInfo } from "./catalog";

/**
 * Calls to the AI providers: checking a key and listing the models it can use.
 * Keys reach this module from the server only; it never runs in the browser.
 */

/** The provider refused the key itself (wrong, revoked or without access). */
export class ProviderKeyError extends Error {}
/** The provider could not be reached or answered with something unexpected. */
export class ProviderError extends Error {}

type Fetch = typeof fetch;

/**
 * Anthropic list prices (US$ per million tokens, input and output), filled in
 * as defaults because the models list carries no prices. The Admin can change
 * them on the settings page.
 */
const ANTHROPIC_PRICES: Record<string, [number, number]> = {
  "claude-fable-5-1": [10, 50],
  "claude-fable-5": [10, 50],
  "claude-opus-5-5": [4, 20],
  "claude-opus-5": [5, 25],
  "claude-opus-4-8": [5, 25],
  "claude-opus-4-7": [5, 25],
  "claude-opus-4-6": [5, 25],
  "claude-sonnet-5-5": [2, 10],
  "claude-sonnet-5": [2, 10],
  "claude-sonnet-4-6": [3, 15],
  "claude-haiku-4-5": [1, 5],
};

const TIMEOUT_MS = 15_000;

async function getJson(fetchImpl: Fetch, url: string, headers: Record<string, string>): Promise<unknown> {
  let res: Response;
  try {
    res = await fetchImpl(url, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (err) {
    throw new ProviderError(`Could not reach the provider: ${(err as Error).message}`);
  }
  if (res.status === 401 || res.status === 403) throw new ProviderKeyError("The provider did not accept this key");
  // Gemini answers a malformed or unknown key with 400 API_KEY_INVALID.
  if (res.status === 400) {
    const body = await res.text().catch(() => "");
    if (/API_KEY_INVALID|api key/i.test(body)) throw new ProviderKeyError("The provider did not accept this key");
    throw new ProviderError(`The provider answered 400: ${body.slice(0, 200)}`);
  }
  if (!res.ok) throw new ProviderError(`The provider answered ${res.status}`);
  return res.json();
}

const perMillion = (perToken: unknown) => {
  const n = Number(perToken);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 1_000_000 * 10_000) / 10_000 : undefined;
};

/**
 * The models this key can use. Throws ProviderKeyError when the key is wrong,
 * which is how a key is checked before it is saved.
 */
export async function listModels(provider: ProviderId, key: string, fetchImpl: Fetch = fetch): Promise<ModelOption[]> {
  switch (provider) {
    case "anthropic": {
      const client = new Anthropic({ apiKey: key, fetch: fetchImpl, maxRetries: 1, timeout: TIMEOUT_MS });
      const models: ModelOption[] = [];
      try {
        for await (const m of client.models.list({ limit: 100 })) {
          const price = ANTHROPIC_PRICES[m.id];
          models.push({ id: m.id, name: m.display_name, inputUsdPerMTok: price?.[0], outputUsdPerMTok: price?.[1] });
        }
      } catch (err) {
        if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
          throw new ProviderKeyError("Anthropic did not accept this key");
        }
        if (err instanceof Anthropic.APIError) throw new ProviderError(`Anthropic answered ${err.status ?? "with an error"}`);
        throw new ProviderError(`Could not reach Anthropic: ${(err as Error).message}`);
      }
      return models;
    }
    case "openai": {
      const body = (await getJson(fetchImpl, "https://api.openai.com/v1/models", {
        Authorization: `Bearer ${key}`,
      })) as { data?: { id: string }[] };
      // The list also holds embedding, audio and image models, which cannot draft text.
      const notText = /embedding|whisper|tts|dall-e|image|audio|realtime|moderation|transcribe|search|davinci|babbage/i;
      return (body.data ?? [])
        .map((m) => m.id)
        .filter((id) => !notText.test(id))
        .sort()
        .map((id) => ({ id, name: id }));
    }
    case "openrouter": {
      // The models list is public, so the key is checked on its own endpoint first.
      await getJson(fetchImpl, "https://openrouter.ai/api/v1/key", { Authorization: `Bearer ${key}` });
      const body = (await getJson(fetchImpl, "https://openrouter.ai/api/v1/models", {
        Authorization: `Bearer ${key}`,
      })) as { data?: { id: string; name?: string; pricing?: { prompt?: string; completion?: string } }[] };
      return (body.data ?? []).map((m) => ({
        id: m.id,
        name: m.name || m.id,
        inputUsdPerMTok: perMillion(m.pricing?.prompt),
        outputUsdPerMTok: perMillion(m.pricing?.completion),
      }));
    }
    case "gemini": {
      const body = (await getJson(fetchImpl, "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000", {
        "x-goog-api-key": key,
      })) as { models?: { name: string; displayName?: string; supportedGenerationMethods?: string[] }[] };
      return (body.models ?? [])
        .filter((m) => m.supportedGenerationMethods?.includes("generateContent"))
        .map((m) => {
          const id = m.name.replace(/^models\//, "");
          return { id, name: m.displayName || id };
        });
    }
  }
}
