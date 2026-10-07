"use client";

import React, { useDeferredValue, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Loader2, Plus, Search, SlidersHorizontal, X } from "lucide-react";
import { modelMaker, type ModelFeature, type ModelOption, type ProviderInfo } from "@/lib/ai/catalog";
import { oneOf, useViewSetting } from "@/lib/view-settings/client";
import {
  activeFilterCount,
  CONTEXT_STEPS,
  FEATURE_LABELS,
  filterModels,
  formatContext,
  formatPrice,
  INPUT_LABELS,
  modelFacets,
  NO_FILTERS,
  PRICE_BANDS,
  SORTS,
  sortModels,
  type ModelFilters,
  type ModelSort,
} from "@/lib/ai/model-browser";

const monthYear = (iso: string) => new Date(iso).toLocaleDateString("en-ZA", { month: "short", year: "numeric" });

const toggle = <T,>(list: T[], item: T) => (list.includes(item) ? list.filter((x) => x !== item) : [...list, item]);

type KeptFilters = Omit<ModelFilters, "query">;
const KEPT_DEFAULT = Object.fromEntries(Object.entries(NO_FILTERS).filter(([k]) => k !== "query")) as KeptFilters;
const isSort = oneOf(SORTS.map((s) => s.id));
const isStrings = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === "string");

function isKeptFilters(v: unknown): v is KeptFilters {
  if (!v || typeof v !== "object") return false;
  const f = v as Record<string, unknown>;
  return (
    PRICE_BANDS.some((b) => b.id === f.price) &&
    typeof f.minContext === "number" &&
    isStrings(f.inputs) &&
    isStrings(f.features) &&
    typeof f.maker === "string" &&
    typeof f.addedOnly === "boolean"
  );
}

/**
 * Everything a provider key can use, to search, filter and sort, adding the
 * models the platform should use to the shortlist. Modelled on OpenRouter's
 * model list.
 */
export function ModelBrowser({
  info,
  models,
  added,
  pending,
  defaultModel,
  onToggle,
  onClose,
}: {
  info: ProviderInfo;
  models: ModelOption[];
  added: ReadonlySet<string>;
  pending: ReadonlySet<string>;
  defaultModel: string | null;
  onToggle: (option: ModelOption) => void;
  onClose: () => void;
}) {
  const facets = useMemo(() => modelFacets(models, info.id), [models, info.id]);
  // The filters and sort last used for this provider are kept; the search box starts empty.
  const [query, setQuery] = useState("");
  const [kept, setKept] = useViewSetting<KeptFilters>(`models.${info.id}.filters`, KEPT_DEFAULT, isKeptFilters);
  const filters = useMemo<ModelFilters>(() => ({ ...kept, query }), [kept, query]);
  const setFilters = ({ query: q, ...rest }: ModelFilters) => {
    setQuery(q);
    setKept(rest);
  };
  const [sort, setSort] = useViewSetting<ModelSort>(`models.${info.id}.sort`, facets.created ? "newest" : "name", isSort);
  const [showFilters, setShowFilters] = useState(false);
  const deferred = useDeferredValue(filters);
  const set = (patch: Partial<ModelFilters>) => setFilters({ ...filters, ...patch });

  const shown = useMemo(
    () => sortModels(filterModels(models, info.id, deferred, added), sort),
    [models, info.id, deferred, added, sort]
  );
  const activeCount = activeFilterCount(filters);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [onClose]);

  const sorts = SORTS.filter(
    (s) =>
      (s.id !== "newest" || facets.created) &&
      ((s.id !== "cheapest" && s.id !== "priciest") || facets.prices) &&
      (s.id !== "context" || facets.context)
  );

  // Rendered on the body: the settings cards animate with a transform, which
  // would otherwise pin a fixed dialog inside the card.
  return createPortal(
    <>
      <div className="scrim" onClick={onClose} />
      <div className="model-browser" role="dialog" aria-modal="true" aria-label={`${info.name} models`}>
        <header className="mb-head">
          <div className="row-between" style={{ gap: "0.75rem" }}>
            <div className="stack" style={{ gap: "0.15rem", minWidth: 0 }}>
              <span className="strong" style={{ fontSize: "1.1rem" }}>{info.name} models</span>
              <span className="small muted">
                {added.size ? `${added.size} added. ` : ""}Add the models you want to use, then pick the default.
              </span>
            </div>
            <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
              <X size={18} />
            </button>
          </div>

          <div className="mb-toolbar">
            <label className="mb-search">
              <Search size={17} aria-hidden />
              <input
                className="input"
                type="search"
                autoFocus
                placeholder={`Search ${models.length} models`}
                value={filters.query}
                onChange={(e) => set({ query: e.target.value })}
                aria-label="Search models"
              />
            </label>
            <label className="mb-sort">
              <span className="sr-only">Sort by</span>
              <select className="input" value={sort} onChange={(e) => setSort(e.target.value as ModelSort)}>
                {sorts.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="btn btn-secondary mb-filter-toggle"
              aria-expanded={showFilters}
              onClick={() => setShowFilters((v) => !v)}
            >
              <SlidersHorizontal size={16} /> Filters{activeCount ? ` (${activeCount})` : ""}
            </button>
          </div>
        </header>

        <div className="mb-body">
          <aside className="mb-filters" data-open={showFilters}>
            <FilterGroup title="Show">
              <button type="button" className="chip" aria-pressed={filters.addedOnly} onClick={() => set({ addedOnly: !filters.addedOnly })}>
                Added only
              </button>
            </FilterGroup>

            {facets.prices && (
              <FilterGroup title="Input price per million">
                {PRICE_BANDS.map((b) => (
                  <button key={b.id} type="button" className="chip" aria-pressed={filters.price === b.id} onClick={() => set({ price: b.id })}>
                    {b.label}
                  </button>
                ))}
              </FilterGroup>
            )}

            {facets.context && (
              <FilterGroup title="Context">
                {CONTEXT_STEPS.map((c) => (
                  <button
                    key={c.tokens}
                    type="button"
                    className="chip"
                    aria-pressed={filters.minContext === c.tokens}
                    onClick={() => set({ minContext: c.tokens })}
                  >
                    {c.label}
                  </button>
                ))}
              </FilterGroup>
            )}

            {facets.inputs.length > 0 && (
              <FilterGroup title="Reads">
                {facets.inputs.map((i) => (
                  <button
                    key={i}
                    type="button"
                    className="chip"
                    aria-pressed={filters.inputs.includes(i)}
                    onClick={() => set({ inputs: toggle(filters.inputs, i) })}
                  >
                    {INPUT_LABELS[i]}
                  </button>
                ))}
              </FilterGroup>
            )}

            {facets.features.length > 0 && (
              <FilterGroup title="Supports">
                {facets.features.map((x: ModelFeature) => (
                  <button
                    key={x}
                    type="button"
                    className="chip"
                    aria-pressed={filters.features.includes(x)}
                    onClick={() => set({ features: toggle(filters.features, x) })}
                  >
                    {FEATURE_LABELS[x]}
                  </button>
                ))}
              </FilterGroup>
            )}

            {facets.makers.length > 1 && (
              <FilterGroup title="Maker">
                <select className="input" value={filters.maker} onChange={(e) => set({ maker: e.target.value })} aria-label="Maker">
                  <option value="">Every maker ({facets.makers.length})</option>
                  {facets.makers.map(([maker, count]) => (
                    <option key={maker} value={maker}>
                      {maker} ({count})
                    </option>
                  ))}
                </select>
              </FilterGroup>
            )}

            {activeCount > 0 && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setFilters({ ...NO_FILTERS, query: filters.query })}>
                Clear filters
              </button>
            )}
          </aside>

          <div className="mb-list">
            <p className="tiny muted mb-count" aria-live="polite">
              {shown.length === models.length ? `${models.length} models` : `Showing ${shown.length} of ${models.length}`}
            </p>
            {shown.length === 0 && <p className="small muted" style={{ padding: "2rem 0", textAlign: "center" }}>No models match.</p>}
            {shown.map((m) => (
              <ModelRow
                key={m.id}
                model={m}
                maker={modelMaker(info.id, m.id)}
                added={added.has(m.id)}
                busy={pending.has(m.id)}
                isDefault={m.id === defaultModel}
                onToggle={() => onToggle(m)}
              />
            ))}
          </div>
        </div>

        <footer className="mb-foot">
          <span className="small muted">
            {added.size === 1 ? "1 model added" : `${added.size} models added`}
          </span>
          <button type="button" className="btn btn-primary" onClick={onClose}>
            Done
          </button>
        </footer>
      </div>
    </>,
    document.body
  );
}

function FilterGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-group" role="group" aria-label={title}>
      <span className="eyebrow">{title}</span>
      <div className="mb-chips">{children}</div>
    </div>
  );
}

function ModelRow({
  model: m,
  maker,
  added,
  busy,
  isDefault,
  onToggle,
}: {
  model: ModelOption;
  maker: string;
  added: boolean;
  busy: boolean;
  isDefault: boolean;
  onToggle: () => void;
}) {
  const free = m.inputUsdPerMTok === 0 && (m.outputUsdPerMTok ?? 0) === 0;
  return (
    <div className="mb-row" data-added={added}>
      <div className="mb-main">
        <div className="row wrap" style={{ gap: "0.4rem" }}>
          <span className="strong">{m.name}</span>
          {isDefault && <span className="tag tag-good">Default</span>}
          {free && <span className="tag tag-me">Free</span>}
        </div>
        <span className="tiny muted mb-id">{m.id}</span>
        {m.description && <p className="small muted mb-desc">{m.description}</p>}
        <div className="mb-meta tiny">
          <span>{maker}</span>
          {m.contextLength != null && <span>{formatContext(m.contextLength)} context</span>}
          {m.inputUsdPerMTok != null && !free && <span>{formatPrice(m.inputUsdPerMTok)}/M in</span>}
          {m.outputUsdPerMTok != null && !free && <span>{formatPrice(m.outputUsdPerMTok)}/M out</span>}
          {m.created && <span>{monthYear(m.created)}</span>}
          {m.inputs?.map((i) => <span key={i}>{INPUT_LABELS[i] ?? i}</span>)}
        </div>
      </div>
      <button
        type="button"
        className={`btn btn-sm ${added ? "btn-secondary" : "btn-primary"} mb-add`}
        aria-pressed={added}
        aria-label={`${added ? "Remove" : "Add"} ${m.name}`}
        disabled={busy || (added && isDefault)}
        title={added && isDefault ? "This is the default model. Choose another default first." : undefined}
        onClick={onToggle}
      >
        {busy ? <Loader2 size={15} className="spin" /> : added ? <Check size={15} strokeWidth={2.5} /> : <Plus size={15} strokeWidth={2.5} />}
        {added ? "Added" : "Add"}
      </button>
    </div>
  );
}
