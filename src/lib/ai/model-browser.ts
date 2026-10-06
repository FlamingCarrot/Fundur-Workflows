import { modelMaker, type ModelFeature, type ModelOption, type ProviderId } from "./catalog";

/**
 * Search, filters and sorting for the model browser on the AI settings page.
 * Pure functions over the provider's list, so they run in the browser and in
 * tests alike.
 */

export type PriceBand = "any" | "free" | "under1" | "1to5" | "over5";
export type ModelSort = "newest" | "name" | "cheapest" | "priciest" | "context";

export interface ModelFilters {
  query: string;
  price: PriceBand;
  /** Smallest context window wanted, in tokens; 0 for any. */
  minContext: number;
  /** Inputs every shown model must read, besides text. */
  inputs: string[];
  features: ModelFeature[];
  /** Empty for every maker. */
  maker: string;
  addedOnly: boolean;
}

export const NO_FILTERS: ModelFilters = {
  query: "",
  price: "any",
  minContext: 0,
  inputs: [],
  features: [],
  maker: "",
  addedOnly: false,
};

export const PRICE_BANDS: { id: PriceBand; label: string }[] = [
  { id: "any", label: "Any price" },
  { id: "free", label: "Free" },
  { id: "under1", label: "Under $1" },
  { id: "1to5", label: "$1 to $5" },
  { id: "over5", label: "Over $5" },
];

export const CONTEXT_STEPS: { tokens: number; label: string }[] = [
  { tokens: 0, label: "Any length" },
  { tokens: 32_000, label: "32K+" },
  { tokens: 128_000, label: "128K+" },
  { tokens: 1_000_000, label: "1M+" },
];

export const FEATURE_LABELS: Record<ModelFeature, string> = {
  tools: "Tools",
  structured: "Structured output",
  reasoning: "Reasoning",
};

export const INPUT_LABELS: Record<string, string> = {
  image: "Images",
  file: "Files",
  audio: "Audio",
  video: "Video",
};

export const SORTS: { id: ModelSort; label: string }[] = [
  { id: "newest", label: "Newest" },
  { id: "name", label: "Name" },
  { id: "cheapest", label: "Cheapest" },
  { id: "priciest", label: "Most expensive" },
  { id: "context", label: "Longest context" },
];

/** How many filters differ from none, for the "Filters (3)" button. */
export function activeFilterCount(f: ModelFilters): number {
  return (
    (f.price !== "any" ? 1 : 0) +
    (f.minContext ? 1 : 0) +
    f.inputs.length +
    f.features.length +
    (f.maker ? 1 : 0) +
    (f.addedOnly ? 1 : 0)
  );
}

function inBand(m: ModelOption, band: PriceBand): boolean {
  if (band === "any") return true;
  const input = m.inputUsdPerMTok;
  if (input == null) return false;
  switch (band) {
    case "free":
      return input === 0 && (m.outputUsdPerMTok ?? 0) === 0;
    case "under1":
      return input < 1;
    case "1to5":
      return input >= 1 && input <= 5;
    case "over5":
      return input > 5;
  }
}

/** The models that pass every filter. Each word of the search must appear in the name, id, maker or description. */
export function filterModels(
  models: ModelOption[],
  provider: ProviderId,
  f: ModelFilters,
  added: ReadonlySet<string>
): ModelOption[] {
  const words = f.query.toLowerCase().split(/\s+/).filter(Boolean);
  return models.filter((m) => {
    if (f.addedOnly && !added.has(m.id)) return false;
    if (f.maker && modelMaker(provider, m.id) !== f.maker) return false;
    if (!inBand(m, f.price)) return false;
    if (f.minContext && (m.contextLength ?? 0) < f.minContext) return false;
    if (f.inputs.some((i) => !m.inputs?.includes(i))) return false;
    if (f.features.some((x) => !m.features?.includes(x))) return false;
    if (words.length) {
      const text = `${m.name} ${m.id} ${m.description ?? ""}`.toLowerCase();
      if (words.some((w) => !text.includes(w))) return false;
    }
    return true;
  });
}

/** A sorted copy. Models without the value sorted on go last, in name order. */
export function sortModels(models: ModelOption[], sort: ModelSort): ModelOption[] {
  const byName = (a: ModelOption, b: ModelOption) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
  const known = <T,>(get: (m: ModelOption) => T | undefined, cmp: (a: T, b: T) => number) => (a: ModelOption, b: ModelOption) => {
    const x = get(a);
    const y = get(b);
    if (x == null && y == null) return byName(a, b);
    if (x == null) return 1;
    if (y == null) return -1;
    return cmp(x, y) || byName(a, b);
  };
  const price = (m: ModelOption) =>
    m.inputUsdPerMTok == null ? undefined : m.inputUsdPerMTok + (m.outputUsdPerMTok ?? 0) / 1000;
  const cmp = {
    newest: known((m) => m.created, (a, b) => b.localeCompare(a)),
    name: byName,
    cheapest: known(price, (a, b) => a - b),
    priciest: known(price, (a, b) => b - a),
    context: known((m) => m.contextLength, (a, b) => b - a),
  }[sort];
  return [...models].sort(cmp);
}

/** What the list holds, so the browser only offers filters and sorts that can match something. */
export function modelFacets(models: ModelOption[], provider: ProviderId) {
  const makers = new Map<string, number>();
  const inputs = new Set<string>();
  const features = new Set<ModelFeature>();
  let prices = false;
  let context = false;
  let created = false;
  for (const m of models) {
    const maker = modelMaker(provider, m.id);
    makers.set(maker, (makers.get(maker) ?? 0) + 1);
    m.inputs?.forEach((i) => inputs.add(i));
    m.features?.forEach((x) => features.add(x));
    prices ||= m.inputUsdPerMTok != null;
    context ||= m.contextLength != null;
    created ||= m.created != null;
  }
  return {
    makers: [...makers.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
    inputs: Object.keys(INPUT_LABELS).filter((i) => inputs.has(i)),
    features: (Object.keys(FEATURE_LABELS) as ModelFeature[]).filter((x) => features.has(x)),
    prices,
    context,
    created,
  };
}

/** 200000 → "200K", 1048576 → "1M". */
export function formatContext(tokens: number): string {
  if (tokens >= 1_000_000) return `${+(tokens / 1_000_000).toFixed(tokens % 1_000_000 ? 1 : 0)}M`;
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}K`;
  return String(tokens);
}

/** US$ per million tokens, short: "$4", "$0.15", "$0.0375", "Free". */
export function formatPrice(usd: number): string {
  if (usd === 0) return "Free";
  if (usd >= 100) return `$${Math.round(usd)}`;
  return `$${+usd.toPrecision(usd < 1 ? 3 : 4)}`;
}
