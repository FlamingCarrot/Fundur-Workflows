/**
 * The AI providers an Admin can hold a key for, as the settings page lists
 * them. Safe to import in the browser; the calls live in providers.ts.
 */

export const PROVIDER_IDS = ["anthropic", "openai", "openrouter", "gemini"] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

export interface ProviderInfo {
  id: ProviderId;
  name: string;
  /** Where to create a key. */
  keyUrl: string;
  keyPlaceholder: string;
  /** True when the provider publishes prices, so they need not be typed in. */
  pricesListed: boolean;
}

export const PROVIDERS: Record<ProviderId, ProviderInfo> = {
  anthropic: {
    id: "anthropic",
    name: "Anthropic",
    keyUrl: "https://platform.claude.com/settings/keys",
    keyPlaceholder: "sk-ant-…",
    pricesListed: false,
  },
  openai: {
    id: "openai",
    name: "OpenAI",
    keyUrl: "https://platform.openai.com/api-keys",
    keyPlaceholder: "sk-…",
    pricesListed: false,
  },
  openrouter: {
    id: "openrouter",
    name: "OpenRouter",
    keyUrl: "https://openrouter.ai/settings/keys",
    keyPlaceholder: "sk-or-…",
    pricesListed: true,
  },
  gemini: {
    id: "gemini",
    name: "Gemini",
    keyUrl: "https://aistudio.google.com/apikey",
    keyPlaceholder: "AIza…",
    pricesListed: false,
  },
};

export function isProviderId(value: unknown): value is ProviderId {
  return typeof value === "string" && (PROVIDER_IDS as readonly string[]).includes(value);
}

export type ModelFeature = "tools" | "structured" | "reasoning";

export interface ModelOption {
  id: string;
  name: string;
  /** US$ per million tokens, when known. */
  inputUsdPerMTok?: number;
  outputUsdPerMTok?: number;
  /** Tokens the model reads in one call, when the provider says. */
  contextLength?: number;
  /** When the model was released or listed, as an ISO date. */
  created?: string;
  /** The provider's own one-paragraph description, shortened. */
  description?: string;
  /** What the model reads besides text: "image", "file", "audio", "video". */
  inputs?: string[];
  features?: ModelFeature[];
}

/**
 * Who makes a model: the part of an OpenRouter id before the slash, or the
 * provider itself, so the model browser can filter by maker.
 */
export function modelMaker(provider: ProviderId, id: string): string {
  const slash = id.indexOf("/");
  return slash > 0 ? id.slice(0, slash) : provider;
}
