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

export interface ModelOption {
  id: string;
  name: string;
  /** US$ per million tokens, when known. */
  inputUsdPerMTok?: number;
  outputUsdPerMTok?: number;
}
