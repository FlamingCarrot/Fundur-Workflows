"use client";

import React, { useState } from "react";
import { Copy, Plus, Trash2 } from "lucide-react";
import { useStudio } from "@/components/providers/StudioProvider";
import { usePlan } from "@/components/billing/usePlan";
import { UpgradeNote } from "@/components/billing/UpgradeNote";
import { WhenReady } from "@/components/ui/primitives";
import { RuleSetConflict } from "@/lib/layout/client";
import { GROUP_SIZES, RULE_FIELDS, rulesProblem, type Adjacency, type LayoutRules, type RuleSet } from "@/lib/layout/rules";
import { relativeTime } from "@/lib/studio/format";
import { isStringOrNull, useViewSetting } from "@/lib/view-settings/client";
import { useRuleSets } from "./useRuleSets";

/**
 * The designer's layout rules (P4-01), kept once and used on every project:
 * desk sizes, clearances, route widths and the pairs that belong near or
 * apart. Several sets can be kept, e.g. one for a call centre.
 */
export function RulesView() {
  const { toast } = useStudio();
  const { sets, failed, reload, backend } = useRuleSets();
  const [picked, setPicked] = useViewSetting<string | null>("layoutRules.set", null, isStringOrNull);
  const billing = usePlan();
  const current = sets?.find((s) => s.id === picked) ?? sets?.[0];

  const copy = async (from: RuleSet) => {
    try {
      const made = await backend.create(`${from.name} (copy)`.slice(0, 120), from.rules);
      await reload();
      setPicked(made.id);
      toast(`"${made.name}" made from ${from.name}`);
    } catch (err) {
      toast((err as Error).message);
    }
  };

  return (
    <main className="page">
      <header className="rise" style={{ marginBottom: "1.75rem" }}>
        <p className="eyebrow" style={{ marginBottom: "0.75rem" }}>Used on every project</p>
        <h1 className="display-l">Layout rules</h1>
        <p className="muted" style={{ marginTop: "0.75rem", maxWidth: 640 }}>
          How you lay out a floor: desk sizes, the space you keep clear, and who belongs near whom. Generated layouts follow
          them, and each option keeps the rules it was made with. They start from common practice; change them to how you work.
        </p>
      </header>
      {billing.access("layout_generator") === "none" && (
        <div style={{ marginBottom: "1.5rem" }}>
          <UpgradeNote title="Layout rules drive the layout generator, which is on the Paid plan">
            You can look at the rules here; making new sets and generating layouts needs Paid.
          </UpgradeNote>
        </div>
      )}
      {failed && !sets && <p className="small" role="alert">The rules could not be loaded. Check your connection and reload the page.</p>}
      <WhenReady ready={!!sets}>
        {sets && current && (
          <>
            <div className="row rise" style={{ gap: "0.5rem", flexWrap: "wrap", marginBottom: "1.5rem" }}>
              <div className="segmented" role="group" aria-label="Rule sets">
                {sets.map((s) => (
                  <button key={s.id} type="button" aria-pressed={s.id === current.id} onClick={() => setPicked(s.id)}>
                    {s.name}
                  </button>
                ))}
              </div>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => copy(current)}>
                <Copy size={14} /> Copy as a new set
              </button>
            </div>
            <RuleSetForm
              key={`${current.id}-${current.revision}`}
              set={current}
              canDelete={sets.length > 1}
              onSave={async (name, rules) => {
                try {
                  await backend.update(current.id, name, rules, current.revision);
                  await reload();
                  toast(`${name} saved`);
                } catch (err) {
                  if (err instanceof RuleSetConflict) {
                    await reload();
                    toast("Someone else saved these rules meanwhile. Their version is shown; make your change again.");
                  } else toast((err as Error).message);
                }
              }}
              onDelete={async () => {
                try {
                  await backend.remove(current.id);
                  await reload();
                  setPicked(null);
                  toast(`${current.name} removed`);
                } catch (err) {
                  toast((err as Error).message);
                }
              }}
            />
          </>
        )}
      </WhenReady>
    </main>
  );
}

function RuleSetForm({
  set,
  canDelete,
  onSave,
  onDelete,
}: {
  set: RuleSet;
  canDelete: boolean;
  onSave: (name: string, rules: LayoutRules) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const [name, setName] = useState(set.name);
  const [rules, setRules] = useState<LayoutRules>(set.rules);
  // Typed text per field, so a half-typed number is not thrown away.
  const [typed, setTyped] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const problem = !name.trim() ? "Give the set a name." : rulesProblem(rules);
  const changed = name !== set.name || JSON.stringify(rules) !== JSON.stringify(set.rules);

  const setNumber = (key: keyof LayoutRules, text: string) => {
    setTyped((t) => ({ ...t, [key]: text }));
    const n = Number(text.replace(/[\s,]/g, ""));
    if (text.trim() && Number.isFinite(n)) setRules((r) => ({ ...r, [key]: n }));
  };
  const toggleGroup = (g: number) =>
    setRules((r) => ({ ...r, groupSizes: r.groupSizes.includes(g) ? r.groupSizes.filter((x) => x !== g) : [...r.groupSizes, g].sort((a, b) => a - b) }));

  return (
    <div className="stack rise" style={{ gap: "1.75rem", ["--i" as string]: 1, maxWidth: 820 }}>
      <label className="field" style={{ maxWidth: 360 }}>
        <span className="field-label">Name</span>
        <input className="input" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
      </label>

      <section className="stack" style={{ gap: "0.75rem" }}>
        <h2 className="display-s">Sizes and clearances</h2>
        <div className="rules-grid">
          {RULE_FIELDS.map((f) => (
            <label key={f.key} className="field">
              <span className="field-label">{f.label}</span>
              <span className="input-unit">
                <input
                  className="input tabular"
                  inputMode="numeric"
                  value={typed[f.key] ?? String(rules[f.key])}
                  onChange={(e) => setNumber(f.key, e.target.value)}
                  aria-describedby={`hint-${f.key}`}
                />
                <span className="tiny muted">mm</span>
              </span>
              <span id={`hint-${f.key}`} className="tiny muted">{f.hint}</span>
            </label>
          ))}
        </div>
      </section>

      <section className="stack" style={{ gap: "0.6rem" }}>
        <h2 className="display-s">Desk groups</h2>
        <p className="small muted">Desks in two facing rows. The generator tries each size you tick, largest first, and fills gaps with smaller groups.</p>
        <div className="row" style={{ gap: "0.4rem", flexWrap: "wrap" }}>
          {GROUP_SIZES.map((g) => (
            <button key={g} type="button" className="chip" aria-pressed={rules.groupSizes.includes(g)} onClick={() => toggleGroup(g)}>
              {g} desks
            </button>
          ))}
        </div>
      </section>

      <section className="stack" style={{ gap: "0.6rem" }}>
        <h2 className="display-s">Near and apart, on every project</h2>
        <p className="small muted">
          Pairs of teams or rooms by name, such as the kitchen away from the boardroom. A project&apos;s own pairs come from its brief.
        </p>
        <PairsEditor pairs={rules.adjacencies} onChange={(adjacencies) => setRules((r) => ({ ...r, adjacencies }))} />
      </section>

      <div className="row" style={{ gap: "0.75rem", flexWrap: "wrap", alignItems: "center" }}>
        <button
          type="button"
          className="btn btn-primary"
          disabled={!changed || !!problem || busy}
          onClick={async () => {
            setBusy(true);
            await onSave(name.trim(), rules);
            setBusy(false);
          }}
        >
          {busy ? "Saving…" : "Save rules"}
        </button>
        {changed && (
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => {
              setName(set.name);
              setRules(set.rules);
              setTyped({});
            }}
          >
            Undo changes
          </button>
        )}
        <span className="grow" />
        {canDelete && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => void onDelete()}>
            <Trash2 size={14} /> Remove this set
          </button>
        )}
      </div>
      {problem && changed && <p className="small" role="alert" style={{ color: "var(--bad)" }}>{problem}</p>}
      <p className="tiny muted">
        Saved {relativeTime(set.updatedAt)}
        {set.updatedBy ? ` by ${set.updatedBy}` : ""}.
      </p>
    </div>
  );
}

/** A list of near and apart pairs, with a row to add one. Names are free text, matched to teams and rooms when used. */
export function PairsEditor({ pairs, onChange, names }: { pairs: Adjacency[]; onChange: (pairs: Adjacency[]) => void; names?: string[] }) {
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const [kind, setKind] = useState<"near" | "apart">("near");
  const listId = React.useId();
  const add = () => {
    if (!a.trim() || !b.trim()) return;
    onChange([...pairs, { a: a.trim().slice(0, 120), b: b.trim().slice(0, 120), kind }]);
    setA("");
    setB("");
  };
  return (
    <div className="stack" style={{ gap: "0.5rem" }}>
      {names && (
        <datalist id={listId}>
          {names.map((n) => (
            <option key={n} value={n} />
          ))}
        </datalist>
      )}
      {pairs.length > 0 && (
        <ul className="plan-list">
          {pairs.map((p, i) => (
            <li key={`${p.a}-${p.b}-${i}`} className="row small" style={{ gap: "0.5rem" }}>
              <span className="grow">
                <strong>{p.a}</strong> {p.kind === "near" ? "near" : "away from"} <strong>{p.b}</strong>
              </span>
              <button type="button" className="icon-btn" aria-label={`Remove ${p.a} ${p.kind} ${p.b}`} onClick={() => onChange(pairs.filter((_, j) => j !== i))}>
                <Trash2 size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="pair-row">
        <input className="input" placeholder="Team or room" value={a} list={names ? listId : undefined} onChange={(e) => setA(e.target.value)} aria-label="First team or room" />
        <select className="input" value={kind} onChange={(e) => setKind(e.target.value as "near" | "apart")} aria-label="Near or apart">
          <option value="near">near</option>
          <option value="apart">away from</option>
        </select>
        <input
          className="input"
          placeholder="Team or room"
          value={b}
          list={names ? listId : undefined}
          onChange={(e) => setB(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
          aria-label="Second team or room"
        />
        <button type="button" className="btn btn-secondary btn-sm" onClick={add} disabled={!a.trim() || !b.trim()}>
          <Plus size={14} /> Add
        </button>
      </div>
    </div>
  );
}
