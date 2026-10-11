import { createHash } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import type { ModelFeature, ModelOption, ProviderId } from "./catalog";

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

/** A description cut to a couple of sentences' length for the model browser. */
const shorten = (text: unknown) => {
  if (typeof text !== "string" || !text.trim()) return undefined;
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > 280 ? `${flat.slice(0, 277).trimEnd()}…` : flat;
};

const positive = (n: unknown) => (typeof n === "number" && Number.isFinite(n) && n > 0 ? n : undefined);

/** A date from unix seconds or an ISO string, left out when unknown or the epoch. */
const isoDate = (v: unknown) => {
  const d = typeof v === "number" ? new Date(v * 1000) : typeof v === "string" ? new Date(v) : null;
  return d && Number.isFinite(d.getTime()) && d.getTime() > 0 ? d.toISOString() : undefined;
};

/** Drops the fields a provider did not fill, so the list stays small. */
function option(m: ModelOption): ModelOption {
  const out = { ...m } as Record<string, unknown>;
  for (const k of Object.keys(out)) {
    const v = out[k];
    if (v === undefined || (Array.isArray(v) && v.length === 0)) delete out[k];
  }
  return out as unknown as ModelOption;
}

interface OpenRouterModel {
  id: string;
  name?: string;
  created?: number;
  description?: string;
  context_length?: number;
  architecture?: { input_modalities?: string[]; output_modalities?: string[] };
  pricing?: { prompt?: string; completion?: string };
  supported_parameters?: string[];
}

const OPENROUTER_FEATURES: Record<string, ModelFeature> = {
  tools: "tools",
  structured_outputs: "structured",
  reasoning: "reasoning",
};

interface XaiModel {
  id: string;
  created?: number;
  input_modalities?: string[];
  output_modalities?: string[];
  prompt_text_token_price?: number;
  completion_text_token_price?: number;
}

/** xAI prices are in US cents per 100 million tokens: 20000 is US$2 per million. */
const xaiPrice = (v: unknown) => {
  const n = Number(v);
  return v != null && Number.isFinite(n) && n >= 0 ? Math.round((n / 10_000) * 10_000) / 10_000 : undefined;
};

/** Where each provider that speaks the OpenAI chat format takes requests. */
export const OPENAI_STYLE_URLS = {
  openai: "https://api.openai.com/v1/chat/completions",
  openrouter: "https://openrouter.ai/api/v1/chat/completions",
  xai: "https://api.x.ai/v1/chat/completions",
} as const;

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
          const caps = m.capabilities;
          models.push(
            option({
              id: m.id,
              name: m.display_name,
              inputUsdPerMTok: price?.[0],
              outputUsdPerMTok: price?.[1],
              contextLength: positive(m.max_input_tokens),
              created: isoDate(m.created_at),
              inputs: caps ? [...(caps.image_input?.supported ? ["image"] : []), ...(caps.pdf_input?.supported ? ["file"] : [])] : undefined,
              features: caps
                ? [
                    "tools" as const,
                    ...(caps.structured_outputs?.supported ? (["structured"] as const) : []),
                    ...(caps.thinking?.supported ? (["reasoning"] as const) : []),
                  ]
                : undefined,
            })
          );
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
      })) as { data?: { id: string; created?: number }[] };
      // Drafting calls Chat Completions, so only the GPT and o-series chat
      // models are offered. The list also holds video, image, audio, embedding
      // and computer-use models, and some (codex, pro, deep research) answer
      // only on the Responses API; none of those can be saved as the default.
      const chat = /^(gpt-|chatgpt-|o\d)/i;
      const notChat =
        /embedding|whisper|tts|dall-e|image|audio|realtime|moderation|transcribe|search|instruct|codex|computer-use|deep-research|-pro\b/i;
      return (body.data ?? [])
        .filter((m) => chat.test(m.id) && !notChat.test(m.id))
        .sort((a, b) => a.id.localeCompare(b.id))
        .map((m) => option({ id: m.id, name: m.id, created: isoDate(m.created) }));
    }
    case "openrouter": {
      // The models list is public, so the key is checked on its own endpoint first.
      await getJson(fetchImpl, "https://openrouter.ai/api/v1/key", { Authorization: `Bearer ${key}` });
      const body = (await getJson(fetchImpl, "https://openrouter.ai/api/v1/models", {
        Authorization: `Bearer ${key}`,
      })) as { data?: OpenRouterModel[] };
      return (
        (body.data ?? [])
          // Text and image roles use this catalog; audio-only models are left out.
          .filter((m) => !m.architecture?.output_modalities || m.architecture.output_modalities.some(x => x === "text" || x === "image"))
          .map((m) =>
            option({
              id: m.id,
              name: m.name || m.id,
              inputUsdPerMTok: perMillion(m.pricing?.prompt),
              outputUsdPerMTok: perMillion(m.pricing?.completion),
              contextLength: positive(m.context_length),
              created: isoDate(m.created),
              description: shorten(m.description),
              inputs: m.architecture?.input_modalities?.filter((x) => x !== "text"),
              outputs: m.architecture?.output_modalities,
              features: [
                ...new Set((m.supported_parameters ?? []).flatMap((p) => (OPENROUTER_FEATURES[p] ? [OPENROUTER_FEATURES[p]] : []))),
              ],
            })
          )
      );
    }
    case "xai": {
      // The language-models list carries prices (in US cents per 100 million
      // tokens) and input types; the plain models list is the fallback.
      const headers = { Authorization: `Bearer ${key}` };
      let rich: { models?: XaiModel[] } | null = null;
      try {
        rich = (await getJson(fetchImpl, "https://api.x.ai/v1/language-models", headers)) as { models?: XaiModel[] };
      } catch (err) {
        if (err instanceof ProviderKeyError) throw err;
      }
      if (rich?.models) {
        return rich.models
          .filter((m) => !m.output_modalities || m.output_modalities.includes("text"))
          .sort((a, b) => a.id.localeCompare(b.id))
          .map((m) =>
            option({
              id: m.id,
              name: m.id,
              inputUsdPerMTok: xaiPrice(m.prompt_text_token_price),
              outputUsdPerMTok: xaiPrice(m.completion_text_token_price),
              created: isoDate(m.created),
              inputs: m.input_modalities?.filter((x) => x !== "text"),
            })
          );
      }
      const body = (await getJson(fetchImpl, "https://api.x.ai/v1/models", headers)) as { data?: { id: string; created?: number }[] };
      return (body.data ?? [])
        .filter((m) => !/image|imagine|video/i.test(m.id))
        .sort((a, b) => a.id.localeCompare(b.id))
        .map((m) => option({ id: m.id, name: m.id, created: isoDate(m.created) }));
    }
    case "gemini": {
      const body = (await getJson(fetchImpl, "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000", {
        "x-goog-api-key": key,
      })) as {
        models?: {
          name: string;
          displayName?: string;
          description?: string;
          inputTokenLimit?: number;
          thinking?: boolean;
          supportedGenerationMethods?: string[];
        }[];
      };
      return (body.models ?? [])
        .filter((m) => m.supportedGenerationMethods?.includes("generateContent"))
        .map((m) => {
          const id = m.name.replace(/^models\//, "");
          return option({
            id,
            name: m.displayName || id,
            contextLength: positive(m.inputTokenLimit),
            description: shorten(m.description),
            features: m.thinking ? ["reasoning"] : undefined,
          });
        });
    }
  }
}

export interface CompletionRequest {
  model: string;
  system: string;
  prompt: string;
  /** A JSON schema the answer must follow, where the provider can enforce one. */
  schema?: Record<string, unknown>;
  maxTokens?: number;
}

export interface Completion {
  text: string;
  inputTokens: number;
  outputTokens: number;
  /** What the provider itself billed, in US$, when it says (OpenRouter does). */
  reportedCostUsd?: number;
}

/** The model answered but declined, or stopped before finishing. */
export class ProviderRefusalError extends ProviderError {}

const COMPLETION_TIMEOUT_MS = 110_000;

async function postJson(fetchImpl: Fetch, url: string, headers: Record<string, string>, body: unknown): Promise<unknown> {
  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(COMPLETION_TIMEOUT_MS),
    });
  } catch (err) {
    throw new ProviderError(`Could not reach the provider: ${(err as Error).message}`);
  }
  if (res.status === 401 || res.status === 403) throw new ProviderKeyError("The provider did not accept the saved key");
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    if (res.status === 400 && /API_KEY_INVALID/.test(detail)) throw new ProviderKeyError("The provider did not accept the saved key");
    throw new ProviderError(`The provider answered ${res.status}: ${detail.slice(0, 300)}`);
  }
  return res.json();
}

/** One request and its answer, with the tokens it used. Runs on the server only. */
export async function complete(
  provider: ProviderId,
  key: string,
  req: CompletionRequest,
  fetchImpl: Fetch = fetch
): Promise<Completion> {
  const maxTokens = req.maxTokens ?? 16_000;
  switch (provider) {
    case "anthropic": {
      const client = new Anthropic({ apiKey: key, fetch: fetchImpl, maxRetries: 2, timeout: COMPLETION_TIMEOUT_MS });
      const send = (withSchema: boolean) =>
        client.messages.create({
          model: req.model,
          max_tokens: maxTokens,
          system: req.system,
          messages: [{ role: "user", content: req.prompt }],
          ...(withSchema && req.schema ? { output_config: { format: { type: "json_schema" as const, schema: req.schema } } } : {}),
        });
      let message: Anthropic.Message;
      try {
        try {
          message = await send(true);
        } catch (err) {
          // Older models do not take a response schema; the prompt still asks for JSON.
          if (err instanceof Anthropic.BadRequestError && req.schema) message = await send(false);
          else throw err;
        }
      } catch (err) {
        if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
          throw new ProviderKeyError("Anthropic did not accept the saved key");
        }
        if (err instanceof Anthropic.APIError) throw new ProviderError(`Anthropic answered ${err.status ?? "with an error"}: ${err.message}`);
        throw new ProviderError(`Could not reach Anthropic: ${(err as Error).message}`);
      }
      const usage = { inputTokens: message.usage.input_tokens, outputTokens: message.usage.output_tokens };
      if (message.stop_reason === "refusal") {
        throw Object.assign(new ProviderRefusalError("The model declined to answer"), usage);
      }
      if (message.stop_reason === "max_tokens") {
        throw Object.assign(new ProviderRefusalError("The answer was cut off before it finished"), usage);
      }
      const text = message.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
      return { text, ...usage };
    }
    case "openai":
    case "openrouter":
    case "xai": {
      const url = OPENAI_STYLE_URLS[provider];
      const body = (await postJson(
        fetchImpl,
        url,
        { Authorization: `Bearer ${key}` },
        {
          model: req.model,
          // xAI takes the older name for the output limit.
          ...(provider === "xai" ? { max_tokens: maxTokens } : { max_completion_tokens: maxTokens }),
          messages: [
            { role: "system", content: req.system },
            { role: "user", content: req.prompt },
          ],
          ...(req.schema
            ? { response_format: { type: "json_schema", json_schema: { name: "answer", strict: true, schema: req.schema } } }
            : {}),
          ...(provider === "openrouter" ? { usage: { include: true } } : {}),
        }
      )) as {
        choices?: { message?: { content?: string | null; refusal?: string | null }; finish_reason?: string }[];
        usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
      };
      const usage = { inputTokens: body.usage?.prompt_tokens ?? 0, outputTokens: body.usage?.completion_tokens ?? 0 };
      const choice = body.choices?.[0];
      if (choice?.message?.refusal) throw Object.assign(new ProviderRefusalError("The model declined to answer"), usage);
      if (choice?.finish_reason === "length") {
        throw Object.assign(new ProviderRefusalError("The answer was cut off before it finished"), usage);
      }
      return {
        text: choice?.message?.content ?? "",
        ...usage,
        reportedCostUsd: typeof body.usage?.cost === "number" ? body.usage.cost : undefined,
      };
    }
    case "gemini": {
      const body = (await postJson(
        fetchImpl,
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(req.model)}:generateContent`,
        { "x-goog-api-key": key },
        {
          systemInstruction: { parts: [{ text: req.system }] },
          contents: [{ role: "user", parts: [{ text: req.prompt }] }],
          generationConfig: { maxOutputTokens: maxTokens, ...(req.schema ? { responseMimeType: "application/json" } : {}) },
        }
      )) as {
        candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] }; finishReason?: string }[];
        usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number };
        promptFeedback?: { blockReason?: string };
      };
      const usage = {
        inputTokens: body.usageMetadata?.promptTokenCount ?? 0,
        // Thinking tokens are billed as output.
        outputTokens: (body.usageMetadata?.candidatesTokenCount ?? 0) + (body.usageMetadata?.thoughtsTokenCount ?? 0),
      };
      const candidate = body.candidates?.[0];
      if (body.promptFeedback?.blockReason || candidate?.finishReason === "SAFETY") {
        throw Object.assign(new ProviderRefusalError("The model declined to answer"), usage);
      }
      if (candidate?.finishReason === "MAX_TOKENS") {
        throw Object.assign(new ProviderRefusalError("The answer was cut off before it finished"), usage);
      }
      const text = (candidate?.content?.parts ?? []).filter((p) => !p.thought).map((p) => p.text ?? "").join("");
      return { text, ...usage };
    }
  }
}

const MODEL_LIST_TTL_MS = 10 * 60_000;
const modelLists = new Map<string, { at: number; models: Promise<ModelOption[]> }>();

/**
 * listModels, remembered for a few minutes per provider and key. Adding models
 * one at a time checks each against the list, and OpenRouter's runs to
 * hundreds of entries, so it is fetched once rather than on every click.
 */
export function listModelsCached(provider: ProviderId, key: string, fetchImpl: Fetch = fetch): Promise<ModelOption[]> {
  const id = `${provider}:${createHash("sha256").update(key).digest("hex")}`;
  const hit = modelLists.get(id);
  if (hit && Date.now() - hit.at < MODEL_LIST_TTL_MS) return hit.models;
  const models = listModels(provider, key, fetchImpl);
  modelLists.set(id, { at: Date.now(), models });
  models.catch(() => modelLists.delete(id));
  return models;
}
