import { test } from "node:test";
import assert from "node:assert/strict";
import type { ModelOption } from "../src/lib/ai/catalog";
import {
  activeFilterCount,
  filterModels,
  formatContext,
  formatPrice,
  modelFacets,
  NO_FILTERS,
  sortModels,
} from "../src/lib/ai/model-browser";

const models: ModelOption[] = [
  {
    id: "anthropic/claude-opus-5-5",
    name: "Claude Opus 5.5",
    inputUsdPerMTok: 4,
    outputUsdPerMTok: 20,
    contextLength: 1_000_000,
    created: "2026-09-01T00:00:00.000Z",
    description: "Frontier model for agents and long documents.",
    inputs: ["image", "file"],
    features: ["tools", "structured", "reasoning"],
  },
  {
    id: "google/gemini-flash",
    name: "Gemini Flash",
    inputUsdPerMTok: 0.15,
    outputUsdPerMTok: 0.6,
    contextLength: 1_048_576,
    created: "2026-05-01T00:00:00.000Z",
    inputs: ["image", "audio", "video"],
    features: ["tools", "structured"],
  },
  { id: "meta/llama-free", name: "Llama Free", inputUsdPerMTok: 0, outputUsdPerMTok: 0, contextLength: 32_768, created: "2025-01-01T00:00:00.000Z" },
  { id: "openrouter/auto", name: "Auto Router" },
];
const ids = (list: ModelOption[]) => list.map((m) => m.id);
const none = new Set<string>();

test("search matches every word against name, id and description", () => {
  assert.deepEqual(ids(filterModels(models, "openrouter", { ...NO_FILTERS, query: "opus" }, none)), ["anthropic/claude-opus-5-5"]);
  assert.deepEqual(ids(filterModels(models, "openrouter", { ...NO_FILTERS, query: "GOOGLE flash" }, none)), ["google/gemini-flash"]);
  assert.deepEqual(ids(filterModels(models, "openrouter", { ...NO_FILTERS, query: "long documents" }, none)), [
    "anthropic/claude-opus-5-5",
  ]);
  assert.equal(filterModels(models, "openrouter", { ...NO_FILTERS, query: "opus flash" }, none).length, 0);
});

test("filters narrow by price, context, inputs, features, maker and the shortlist", () => {
  const f = (patch: Partial<typeof NO_FILTERS>, added = none) => ids(filterModels(models, "openrouter", { ...NO_FILTERS, ...patch }, added));
  assert.deepEqual(f({ price: "free" }), ["meta/llama-free"]);
  assert.deepEqual(f({ price: "under1" }), ["google/gemini-flash", "meta/llama-free"]);
  assert.deepEqual(f({ price: "1to5" }), ["anthropic/claude-opus-5-5"]);
  assert.deepEqual(f({ price: "over5" }), []);
  assert.deepEqual(f({ minContext: 1_000_000 }), ["anthropic/claude-opus-5-5", "google/gemini-flash"]);
  assert.deepEqual(f({ inputs: ["image", "file"] }), ["anthropic/claude-opus-5-5"]);
  assert.deepEqual(f({ features: ["reasoning"] }), ["anthropic/claude-opus-5-5"]);
  assert.deepEqual(f({ maker: "meta" }), ["meta/llama-free"]);
  assert.deepEqual(f({ addedOnly: true }, new Set(["openrouter/auto"])), ["openrouter/auto"]);
  assert.equal(activeFilterCount({ ...NO_FILTERS, query: "x", inputs: ["image", "file"], maker: "meta" }), 3);
});

test("sorting puts models without the value last", () => {
  assert.deepEqual(ids(sortModels(models, "newest")), ["anthropic/claude-opus-5-5", "google/gemini-flash", "meta/llama-free", "openrouter/auto"]);
  assert.deepEqual(ids(sortModels(models, "cheapest")), ["meta/llama-free", "google/gemini-flash", "anthropic/claude-opus-5-5", "openrouter/auto"]);
  assert.deepEqual(ids(sortModels(models, "priciest")), ["anthropic/claude-opus-5-5", "google/gemini-flash", "meta/llama-free", "openrouter/auto"]);
  assert.deepEqual(ids(sortModels(models, "context")), ["google/gemini-flash", "anthropic/claude-opus-5-5", "meta/llama-free", "openrouter/auto"]);
  assert.deepEqual(ids(sortModels(models, "name")), ["openrouter/auto", "anthropic/claude-opus-5-5", "google/gemini-flash", "meta/llama-free"]);
});

test("facets offer only what the list can match", () => {
  const all = modelFacets(models, "openrouter");
  assert.deepEqual(all.makers[0], ["anthropic", 1]);
  assert.equal(all.makers.length, 4);
  assert.deepEqual(all.inputs, ["image", "file", "audio", "video"]);
  assert.deepEqual(all.features, ["tools", "structured", "reasoning"]);
  const openai = modelFacets([{ id: "gpt-5", name: "gpt-5" }], "openai");
  assert.deepEqual(openai.makers, [["openai", 1]]);
  assert.equal(openai.prices || openai.context || openai.created, false);
});

test("context and prices read short", () => {
  assert.equal(formatContext(200_000), "200K");
  assert.equal(formatContext(131_072), "131K");
  assert.equal(formatContext(1_000_000), "1M");
  assert.equal(formatContext(1_048_576), "1M");
  assert.equal(formatContext(2_500_000), "2.5M");
  assert.equal(formatPrice(4), "$4");
  assert.equal(formatPrice(0.15), "$0.15");
  assert.equal(formatPrice(0.0375), "$0.0375");
  assert.equal(formatPrice(0), "Free");
  assert.equal(formatPrice(150), "$150");
});
