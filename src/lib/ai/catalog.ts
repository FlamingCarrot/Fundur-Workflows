/**
 * The AI providers an Admin can hold a key for, as the settings page lists
 * them. Safe to import in the browser; the calls live in providers.ts.
 */

export const PROVIDER_IDS = ["anthropic", "openai", "gemini", "xai", "openrouter"] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

export interface ProviderInfo {
  id: ProviderId;
  name: string;
  /** Where to create a key. */
  keyUrl: string;
  keyPlaceholder: string;
  /** True when the provider publishes prices, so they need not be typed in. */
  pricesListed: boolean;
  /**
   * What the provider's model list carries, checked against each list
   * endpoint (P4-08): the browser offers only the filters it can fill.
   */
  listNotes: string;
}

export const PROVIDERS: Record<ProviderId, ProviderInfo> = {
  anthropic: {
    id: "anthropic",
    name: "Anthropic",
    keyUrl: "https://platform.claude.com/settings/keys",
    keyPlaceholder: "sk-ant-…",
    pricesListed: false,
    listNotes: "Lists context size, image and PDF input, tools and reasoning. No prices, so list prices are filled in.",
  },
  openai: {
    id: "openai",
    name: "OpenAI",
    keyUrl: "https://platform.openai.com/api-keys",
    keyPlaceholder: "sk-…",
    pricesListed: false,
    listNotes: "Lists model names only: no prices, context size or capability tags.",
  },
  openrouter: {
    id: "openrouter",
    name: "OpenRouter",
    keyUrl: "https://openrouter.ai/settings/keys",
    keyPlaceholder: "sk-or-…",
    pricesListed: true,
    listNotes: "Lists prices, context size, input types, tools, structured output and reasoning for every model.",
  },
  gemini: {
    id: "gemini",
    name: "Gemini",
    keyUrl: "https://aistudio.google.com/apikey",
    keyPlaceholder: "AIza…",
    pricesListed: false,
    listNotes: "Lists context size and reasoning. No prices.",
  },
  xai: {
    id: "xai",
    name: "Grok",
    keyUrl: "https://console.x.ai",
    keyPlaceholder: "xai-…",
    pricesListed: true,
    listNotes: "Lists prices and image input. No context size or capability tags.",
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
