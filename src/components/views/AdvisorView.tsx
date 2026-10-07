"use client";

import React, { useEffect, useState } from "react";
import { Check, Play, RotateCcw, Sparkles, Trash2, X } from "lucide-react";
import { useStudio } from "@/components/providers/StudioProvider";
import { relativeTime, zar } from "@/lib/studio/format";
import type { AdvisorRun, ResearchKind, ResearchNote, Suggestion } from "@/lib/analytics/advisor";
import { SettingsTabs } from "./SettingsTabs";
import { useRemembered } from "./UsageView";

/**
 * Improve next: the AI's reading of usage, reports and research, with the one
 * thing to do next at the top and why. The Admin starts it, marks it done or
 * sets it aside, and the next one rises.
 */

interface AdvisorState {
  run: AdvisorRun | null;
  active: Suggestion[];
  finished: Suggestion[];
  research: ResearchNote[];
}

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { "Content-Type": "application/json" } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
  return body as T;
}

const IMPACT_TAG: Record<Suggestion["impact"], string> = { high: "tag-me", medium: "tag-client", low: "tag-ai" };
const EFFORT_LABEL: Record<Suggestion["effort"], string> = { small: "Small job", medium: "Medium job", large: "Big job" };
const KIND_LABEL: Record<ResearchKind, string> = { customer: "Customer", competitor: "Competitor", other: "Other" };

export function AdvisorView() {
  const { toast } = useStudio();
  const [state, setState] = useState<AdvisorState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [thinking, setThinking] = useState(false);
  const [periodDays, setPeriodDays] = useRemembered<number>("fundur.advisor.days", 30);
  const [showFinished, setShowFinished] = useRemembered<boolean>("fundur.advisor.showFinished", false);

  useEffect(() => {
    call<AdvisorState>("/api/admin/advisor").then(setState, (err: Error) => setLoadError(err.message));
  }, []);

  const ask = () => {
    setThinking(true);
    call<AdvisorState>("/api/admin/advisor", { method: "POST", body: JSON.stringify({ periodDays }) })
      .then((s) => {
        setState(s);
        toast("New advice is ready");
      })
      .catch((err: Error) => toast(err.message))
      .finally(() => setThinking(false));
  };

  const setStatus = (s: Suggestion, status: "open" | "doing" | "done" | "dismissed") =>
    call<{ suggestion: Suggestion }>(`/api/admin/advisor/suggestions/${s.id}`, { method: "PATCH", body: JSON.stringify({ status }) }).then(
      () => call<AdvisorState>("/api/admin/advisor").then(setState),
      (err: Error) => toast(`That didn't save: ${err.message}`)
    );

  const next = state?.active[0];
  const rest = state?.active.slice(1) ?? [];

  return (
    <main className="page page-narrow">
      <SettingsTabs />
      <header className="rise" style={{ marginBottom: "2rem" }}>
        <p className="eyebrow" style={{ marginBottom: "0.75rem" }}>Admin</p>
        <h1 className="display-l">Improve next</h1>
        <p className="muted" style={{ marginTop: "0.75rem" }}>
          The AI reads how people use the app, what they report, and your customer and competitor research, then tells
          you the one thing to improve next and why.
        </p>
      </header>

      {loadError && !state && <div className="card" style={{ padding: "1.25rem 1.4rem", color: "var(--bad)" }}>{loadError}</div>}
      {!state && !loadError && <p className="muted">Loading…</p>}

      {state && (
        <div className="stack" style={{ gap: "2.25rem" }}>
          {next ? (
            <NextCard suggestion={next} onStatus={(st) => setStatus(next, st)} />
          ) : (
            <section className="card advisor-next" style={{ textAlign: "center" }}>
              <Sparkles size={22} />
              <h2 className="display-s" style={{ margin: "0.6rem 0 0.4rem" }}>
                {state.run ? "You've worked through the list" : "Ask what to improve first"}
              </h2>
              <p className="muted small" style={{ marginBottom: "1.1rem" }}>
                {state.run
                  ? "Ask again for a fresh reading of the latest numbers."
                  : "The advisor reads the usage numbers, open reports and your research notes. It works even with little data yet, leaning on research and comparable products."}
              </p>
              <AskButton thinking={thinking} onAsk={ask} label={state.run ? "Read the numbers again" : "Get advice"} />
            </section>
          )}

          {rest.length > 0 && (
            <section>
              <div className="section-title">
                <h2>Then<span className="count">{rest.length}</span></h2>
              </div>
              <div className="stack" style={{ gap: "0.6rem" }}>
                {rest.map((s) => (
                  <LaterCard key={s.id} suggestion={s} onStatus={(st) => setStatus(s, st)} />
                ))}
              </div>
            </section>
          )}

          {state.run && (
            <section className="card" style={{ padding: "1.2rem 1.35rem" }}>
              <div className="row-between wrap" style={{ gap: "0.75rem", marginBottom: "0.6rem" }}>
                <p className="small strong">What the numbers say</p>
                <span className="tiny muted">
                  {relativeTime(state.run.createdAt)} · last {state.run.periodDays} days
                  {state.run.model ? ` · ${state.run.model}` : ""} · {zar(state.run.costZar)}
                </span>
              </div>
              <p className="small" style={{ whiteSpace: "pre-wrap" }}>{state.run.summary}</p>
              <Evidence run={state.run} />
              <div className="row wrap" style={{ gap: "0.6rem", marginTop: "1rem", alignItems: "center" }}>
                <div className="segmented" role="group" aria-label="Period">
                  {[7, 30, 90].map((d) => (
                    <button key={d} type="button" aria-pressed={periodDays === d} onClick={() => setPeriodDays(d)}>
                      {d} days
                    </button>
                  ))}
                </div>
                <AskButton thinking={thinking} onAsk={ask} label="Read again" small />
              </div>
            </section>
          )}

          <Research
            notes={state.research}
            onChange={(research) => setState((s) => (s ? { ...s, research } : s))}
          />

          {state.finished.length > 0 && (
            <section>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowFinished(!showFinished)}>
                {showFinished ? "Hide" : "Show"} done and set aside ({state.finished.length})
              </button>
              {showFinished && (
                <ul className="usage-list" style={{ marginTop: "0.75rem" }}>
                  {state.finished.map((s) => (
                    <li key={s.id}>
                      <span className={`tag ${s.status === "done" ? "tag-good" : "tag-ai"}`} style={{ height: 22, fontSize: "0.7rem" }}>
                        {s.status === "done" ? "Done" : "Set aside"}
                      </span>
                      <span className="small grow">{s.title}</span>
                      <span className="tiny muted">{s.statusChangedAt ? relativeTime(s.statusChangedAt) : ""}</span>
                      <button type="button" className="icon-btn" title="Put back on the list" aria-label="Put back on the list" onClick={() => setStatus(s, "open")}>
                        <RotateCcw size={14} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
        </div>
      )}
    </main>
  );
}

function AskButton({ thinking, onAsk, label, small }: { thinking: boolean; onAsk: () => void; label: string; small?: boolean }) {
  return (
    <button type="button" className={`btn btn-primary ${small ? "btn-sm" : ""}`} disabled={thinking} onClick={onAsk}>
      <Sparkles size={15} />
      {thinking ? "Reading the numbers…" : label}
    </button>
  );
}

function Tags({ s }: { s: Suggestion }) {
  return (
    <div className="row wrap" style={{ gap: "0.4rem" }}>
      <span className={`tag ${IMPACT_TAG[s.impact]}`}>{s.impact[0].toUpperCase() + s.impact.slice(1)} impact</span>
      <span className="tag tag-ai">{EFFORT_LABEL[s.effort]}</span>
      {s.area && <span className="tag tag-ai">{s.area}</span>}
      {s.status === "doing" && <span className="tag tag-good tag-dot">Under way</span>}
    </div>
  );
}

function NextCard({ suggestion: s, onStatus }: { suggestion: Suggestion; onStatus: (status: "doing" | "done" | "dismissed") => void }) {
  return (
    <section className="card advisor-next rise">
      <p className="eyebrow" style={{ marginBottom: "0.6rem" }}>Do this next</p>
      <h2 className="display-m" style={{ marginBottom: "0.85rem" }}>{s.title}</h2>
      <Tags s={s} />
      <p style={{ marginTop: "1.1rem" }}>
        <strong>Why: </strong>
        {s.why}
      </p>
      {s.evidence && (
        <p className="small muted" style={{ marginTop: "0.6rem" }}>
          <strong>Based on: </strong>
          {s.evidence}
          {s.basis.length > 0 && <span> ({s.basis.join(", ")})</span>}
        </p>
      )}
      {s.steps.length > 0 && (
        <ol className="advisor-steps">
          {s.steps.map((step, i) => (
            <li key={i}>{step}</li>
          ))}
        </ol>
      )}
      <div className="row wrap" style={{ gap: "0.5rem", marginTop: "1.25rem" }}>
        {s.status === "open" && (
          <button type="button" className="btn btn-secondary" onClick={() => onStatus("doing")}>
            <Play size={15} /> Start
          </button>
        )}
        <button type="button" className="btn btn-primary" onClick={() => onStatus("done")}>
          <Check size={15} /> Done
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => onStatus("dismissed")}>
          <X size={15} /> Not now
        </button>
      </div>
    </section>
  );
}

function LaterCard({ suggestion: s, onStatus }: { suggestion: Suggestion; onStatus: (status: "doing" | "done" | "dismissed") => void }) {
  return (
    <details className="card advisor-later">
      <summary>
        <span className="small strong grow">{s.title}</span>
        <span className={`tag ${IMPACT_TAG[s.impact]}`} style={{ height: 22, fontSize: "0.7rem" }}>{s.impact}</span>
      </summary>
      <div style={{ padding: "0 1.15rem 1rem" }}>
        <Tags s={s} />
        <p className="small" style={{ marginTop: "0.7rem" }}>{s.why}</p>
        {s.evidence && <p className="tiny muted" style={{ marginTop: "0.4rem" }}>Based on: {s.evidence}</p>}
        {s.steps.length > 0 && (
          <ol className="advisor-steps small">
            {s.steps.map((step, i) => (
              <li key={i}>{step}</li>
            ))}
          </ol>
        )}
        <div className="row wrap" style={{ gap: "0.4rem", marginTop: "0.8rem" }}>
          {s.status === "open" && (
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => onStatus("doing")}>Start</button>
          )}
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => onStatus("done")}>Done</button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => onStatus("dismissed")}>Not now</button>
        </div>
      </div>
    </details>
  );
}

function Evidence({ run }: { run: AdvisorRun }) {
  const e = run.evidence;
  if (!e?.overview) return null;
  const t = e.overview.totals;
  const facts = [
    [t.activeUsers, "active people"],
    [t.sessions, "visits"],
    [t.pageViews, "page views"],
    [t.errors, "errors"],
    [e.tickets.open, "open reports"],
    [e.research.length, "research notes"],
  ] as const;
  return (
    <div className="row wrap" style={{ gap: "0.4rem 1.1rem", marginTop: "0.8rem" }}>
      {facts.map(([n, label]) => (
        <span key={label} className="tiny muted">
          <strong className="tabular" style={{ color: "var(--ink)" }}>{n}</strong> {label}
        </span>
      ))}
    </div>
  );
}

function Research({ notes, onChange }: { notes: ResearchNote[]; onChange: (notes: ResearchNote[]) => void }) {
  const { toast } = useStudio();
  const [kind, setKind] = useState<ResearchKind>("customer");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState(false);

  const save = () => {
    setSaving(true);
    call<{ note: ResearchNote }>("/api/admin/advisor/research", { method: "POST", body: JSON.stringify({ kind, title, body }) })
      .then(({ note }) => {
        onChange([note, ...notes]);
        setTitle("");
        setBody("");
        setOpen(false);
      })
      .catch((err: Error) => toast(err.message))
      .finally(() => setSaving(false));
  };

  const remove = (id: string) =>
    call(`/api/admin/advisor/research/${id}`, { method: "DELETE" }).then(
      () => onChange(notes.filter((n) => n.id !== id)),
      (err: Error) => toast(err.message)
    );

  return (
    <section>
      <div className="section-title">
        <h2>Research<span className="count">{notes.length}</span></h2>
        {!open && (
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setOpen(true)}>Add a note</button>
        )}
      </div>
      <p className="small muted" style={{ marginBottom: "1rem" }}>
        What customers told you and what competitors do. The advisor reads these with the numbers. Without notes it uses
        what it knows about comparable products, and says so.
      </p>
      {open && (
        <div className="card stack" style={{ padding: "1.1rem 1.2rem", gap: "0.75rem", marginBottom: "1rem" }}>
          <div className="segmented" role="group" aria-label="Kind" style={{ alignSelf: "flex-start" }}>
            {(Object.keys(KIND_LABEL) as ResearchKind[]).map((k) => (
              <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)}>{KIND_LABEL[k]}</button>
            ))}
          </div>
          <input
            className="input"
            placeholder={kind === "competitor" ? "e.g. Houzz Pro onboarding" : "e.g. Call with a designer in Cape Town"}
            value={title}
            maxLength={200}
            onChange={(e) => setTitle(e.target.value)}
          />
          <textarea
            className="textarea"
            rows={5}
            placeholder="What you learned"
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
          <div className="row" style={{ justifyContent: "flex-end", gap: "0.4rem" }}>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(false)}>Cancel</button>
            <button type="button" className="btn btn-primary btn-sm" disabled={saving || !title.trim() || !body.trim()} onClick={save}>
              Save note
            </button>
          </div>
        </div>
      )}
      {notes.length > 0 && (
        <div className="stack" style={{ gap: "0.5rem" }}>
          {notes.map((n) => (
            <details key={n.id} className="card advisor-later">
              <summary>
                <span className="tag tag-ai" style={{ height: 22, fontSize: "0.7rem" }}>{KIND_LABEL[n.kind]}</span>
                <span className="small strong grow">{n.title}</span>
                <span className="tiny muted">{relativeTime(n.createdAt)}</span>
              </summary>
              <div style={{ padding: "0 1.15rem 1rem" }}>
                <p className="small" style={{ whiteSpace: "pre-wrap" }}>{n.body}</p>
                <button type="button" className="btn btn-ghost btn-sm" style={{ marginTop: "0.6rem" }} onClick={() => remove(n.id)}>
                  <Trash2 size={14} /> Delete
                </button>
              </div>
            </details>
          ))}
        </div>
      )}
    </section>
  );
}
