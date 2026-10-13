"use client";

import { useMemo, useState } from "react";
import { ChevronDown, X } from "lucide-react";
import { MATERIAL_CATEGORIES, isStandard } from "@/lib/blueprints/types";
import type { Resolver } from "@/lib/blueprints/resolve";
import { MaterialSwatch } from "./MaterialSwatch";

/** Picks a material from the library by its swatch; "none" leaves the default. */
export function MaterialPicker({
  lib,
  label,
  value,
  onChange,
  noneLabel,
}: {
  lib: Resolver;
  label: string;
  value: string | undefined;
  onChange: (id: string | null) => void;
  /** Offered as the first choice when set, e.g. "Blueprint's own". */
  noneLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const current = value ? lib.material(value) : undefined;
  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = lib.materials.filter((m) => !q || `${m.name} ${m.category}`.toLowerCase().includes(q));
    return MATERIAL_CATEGORIES.map((c) => ({ category: c, items: list.filter((m) => m.category === c) })).filter((g) => g.items.length);
  }, [lib, query]);
  return (
    <div className="stack mat-picker" style={{ gap: "0.35rem" }}>
      <span className="field-label">{label}</span>
      <button type="button" className="input mat-current" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <MaterialSwatch material={current} size={22} />
        <span className="small grow truncate" style={{ textAlign: "left" }}>
          {current?.name ?? (value ? "Missing material" : noneLabel ?? "None")}
        </span>
        <ChevronDown size={15} aria-hidden />
      </button>
      {open && (
        <div className="mat-grid-wrap">
          <div className="row" style={{ gap: "0.4rem" }}>
            <input className="input" type="search" placeholder="Search materials" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search materials" autoFocus />
            <button type="button" className="icon-btn" aria-label="Close" onClick={() => setOpen(false)}>
              <X size={16} />
            </button>
          </div>
          {noneLabel && (
            <button type="button" className="mat-option" aria-pressed={!value} onClick={() => (onChange(null), setOpen(false))}>
              <MaterialSwatch material={undefined} size={22} />
              <span className="tiny">{noneLabel}</span>
            </button>
          )}
          {groups.map((g) => (
            <div key={g.category} className="stack" style={{ gap: "0.3rem" }}>
              <span className="eyebrow">{g.category}</span>
              <div className="mat-grid">
                {g.items.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    className="mat-option"
                    aria-pressed={value === m.id}
                    title={m.source?.licence ? `${m.name} · ${m.source.name}, ${m.source.licence}` : m.name}
                    onClick={() => {
                      onChange(m.id);
                      setOpen(false);
                    }}
                  >
                    <MaterialSwatch material={m} size={34} />
                    <span className="tiny truncate">{m.name}</span>
                    {!isStandard(m.id) && <span className="lib-badge">Ours</span>}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
