"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { BLUEPRINT_CATEGORIES, isStandard, type Blueprint, type BlueprintKind } from "@/lib/blueprints/types";
import type { Resolver } from "@/lib/blueprints/resolve";
import { useViewSetting } from "@/lib/view-settings/client";
import { BlueprintThumb } from "./BlueprintThumb";

/**
 * Browsing the design library by picture: search, a category, and the
 * practice's own blueprints or the defaults. Used to place furniture on the
 * plan, to swap an item for another, and to nest one blueprint in another.
 */

type Source = "all" | "mine" | "default";
const isSource = (v: unknown): v is Source => v === "all" || v === "mine" || v === "default";
const isText = (v: unknown): v is string => typeof v === "string" && v.length <= 40;

const size = (b: Blueprint) => `${Math.round(b.size.w)} × ${Math.round(b.size.d)}`;

export function LibraryBrowser({
  lib,
  kind = "object",
  selected,
  onPick,
  settingKey = "library.browse",
  exclude,
  compact = false,
}: {
  lib: Resolver;
  kind?: BlueprintKind | "any";
  selected?: string;
  onPick: (bp: Blueprint) => void;
  /** Where the search and filters are remembered for this person. */
  settingKey?: string;
  /** Leaves out blueprints that cannot be picked, e.g. one that would nest in itself. */
  exclude?: (bp: Blueprint) => boolean;
  compact?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useViewSetting<string>(`${settingKey}.category`, "All", isText);
  const [source, setSource] = useViewSetting<Source>(`${settingKey}.source`, "all", isSource);
  const pool = useMemo(() => lib.blueprints.filter((b) => (kind === "any" || b.kind === kind) && !exclude?.(b)), [lib, kind, exclude]);
  const categories = useMemo(() => ["All", ...BLUEPRINT_CATEGORIES.filter((c) => pool.some((b) => b.category === c))], [pool]);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return pool
      .filter((b) => (source === "all" ? true : source === "mine" ? !isStandard(b.id) : isStandard(b.id)))
      .filter((b) => category === "All" || !categories.includes(category) || b.category === category)
      .filter((b) => !q || `${b.name} ${b.category} ${b.type} ${(b.tags ?? []).join(" ")}`.toLowerCase().includes(q))
      .sort((a, b) => Number(isStandard(a.id)) - Number(isStandard(b.id)) || a.name.localeCompare(b.name));
  }, [pool, source, category, categories, query]);
  const mine = pool.some((b) => !isStandard(b.id));
  return (
    <div className="stack lib-browser" style={{ gap: "0.6rem" }}>
      <label className="lib-search">
        <Search size={15} aria-hidden />
        <input className="input" type="search" placeholder="Search the library" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search the library" />
      </label>
      {mine && (
        <div className="segmented lib-source" role="group" aria-label="Whose">
          {(
            [
              ["all", "All"],
              ["mine", "Ours"],
              ["default", "Defaults"],
            ] as [Source, string][]
          ).map(([k, text]) => (
            <button key={k} type="button" aria-pressed={source === k} onClick={() => setSource(k)}>
              {text}
            </button>
          ))}
        </div>
      )}
      {categories.length > 2 && (
        <div className="chip-row" role="group" aria-label="Category">
          {categories.map((c) => (
            <button key={c} type="button" className="chip" aria-pressed={category === c || (c === "All" && !categories.includes(category))} onClick={() => setCategory(c)}>
              {c}
            </button>
          ))}
        </div>
      )}
      {shown.length === 0 ? (
        <p className="tiny muted">Nothing matches. Try another word or category.</p>
      ) : (
        <div className={`lib-grid${compact ? " lib-grid-compact" : ""}`}>
          {shown.map((b) => (
            <button key={b.id} type="button" className="lib-card" aria-pressed={selected === b.id} onClick={() => onPick(b)} title={`${b.name}, ${size(b)} mm`}>
              <BlueprintThumb lib={lib} blueprint={b} size={compact ? 52 : 68} />
              <span className="tiny lib-name">{b.name}</span>
              {!compact && <span className="tiny muted tabular">{size(b)}</span>}
              {!isStandard(b.id) && <span className="lib-badge" aria-label="Your practice's">Ours</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
