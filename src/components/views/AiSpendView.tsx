"use client";

import React, { useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowLeft, X } from "lucide-react";
import { useStudio } from "@/components/providers/StudioProvider";
import { WhenReady, swatchVar } from "@/components/ui/primitives";
import { useAiSpend, type AiSpend, type CostLine } from "@/hooks/useAiSpend";
import { zar } from "@/lib/studio/format";
import type { Project } from "@/lib/studio/types";
import { ProjectNavigation } from "@/components/projects/ProjectNavigation";
import { MissingProject } from "./MissingProject";

/**
 * Where a project's AI money went (P4-15): the total, by phase, by task, by
 * kind of work and by model, every figure a sum of the call log. The Admin
 * sets the project's budget and alert level here (P4-16).
 */
export function AiSpendView({ projectId }: { projectId: string }) {
  const { ready, getProject } = useStudio();
  const project = getProject(projectId);
  return (
    <main className="page project-work-page">
      <WhenReady ready={ready}>{project ? <Spend project={project} /> : <MissingProject />}</WhenReady>
    </main>
  );
}

function Spend({ project }: { project: Project }) {
  const { persistence } = useStudio();
  const { data, error, mutate } = useAiSpend(project.id, project.aiSpendZar);

  return (
    <div style={swatchVar(project.swatch)}>
      <ProjectNavigation project={project} />
      <Link href={`/projects/${project.id}`} className="back-link rise" style={{ marginBottom: "2rem" }}>
        <ArrowLeft size={15} /> {project.name}
      </Link>
      <header className="rise" style={{ ["--i" as string]: 1, marginBottom: "2rem" }}>
        <p className="eyebrow" style={{ marginBottom: "0.75rem" }}>AI spend</p>
        <h1 className="display-l">{zar(data?.costs.totalZar ?? project.aiSpendZar)}</h1>
        <p className="muted" style={{ marginTop: "0.6rem" }}>
          {data
            ? `${data.costs.calls} AI call${data.costs.calls === 1 ? "" : "s"} on this project${
                data.costs.failedCalls ? `, ${data.costs.failedCalls} of them failed (failed calls can still cost)` : ""
              }. Every figure here adds up from the call log.`
            : persistence === "server"
              ? "Loading…"
              : "The demo keeps a pretend total only. Signed in, every call is logged and broken down here."}
        </p>
      </header>
      {error && <p className="small" role="alert" style={{ color: "var(--bad)" }}>{(error as Error).message}</p>}
      {data && (
        <>
          <BudgetCard project={project} data={data} onSaved={(d) => mutate(d, { revalidate: false })} />
          <Breakdown title="By phase" lines={data.costs.byPhase} total={data.costs.totalZar} />
          <Breakdown title="By task" lines={data.costs.byTask} total={data.costs.totalZar} empty="No AI work was asked from a task yet." />
          <Breakdown title="By kind of work" lines={data.costs.byTaskType} total={data.costs.totalZar} />
          <Breakdown title="By model" lines={data.costs.byModel} total={data.costs.totalZar} />
        </>
      )}
    </div>
  );
}

function Breakdown({ title, lines, total, empty }: { title: string; lines: CostLine[]; total: number; empty?: string }) {
  return (
    <section className="rise" style={{ ["--i" as string]: 3, marginTop: "2rem" }}>
      <div className="section-title">
        <h2>{title}</h2>
      </div>
      <div className="card" style={{ padding: "0.4rem 1.25rem" }}>
        {lines.length === 0 ? (
          <p className="small muted" style={{ padding: "0.6rem 0" }}>{empty ?? "Nothing yet."}</p>
        ) : (
          <div className="cost-table">
            {lines.map((l) => (
              <div key={l.key || l.label} className="cost-row">
                <span className="stack grow" style={{ gap: "0.3rem", minWidth: 0 }}>
                  <span className="truncate">{l.label}</span>
                  <span className="cost-bar" aria-hidden>
                    <span style={{ width: `${total > 0 ? Math.max(2, (l.zar / total) * 100) : 0}%` }} />
                  </span>
                </span>
                <span className="stack" style={{ alignItems: "flex-end", gap: "0.1rem" }}>
                  <span className="strong tabular">{zar(l.zar)}</span>
                  <span className="tiny muted">{l.calls} call{l.calls === 1 ? "" : "s"}</span>
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function BudgetCard({ project, data, onSaved }: { project: Project; data: AiSpend; onSaved: (d: AiSpend) => void }) {
  const { toast } = useStudio();
  const { budget, alerts } = data;
  const [editing, setEditing] = useState(false);
  const [amount, setAmount] = useState(budget.budgetZar != null ? String(budget.budgetZar) : "");
  const [percent, setPercent] = useState(String(budget.alertPercent));
  const [pause, setPause] = useState(budget.pauseAtLimit);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const base = `/api/projects/${encodeURIComponent(project.id)}/ai`;

  const save = async (budgetZar: number | null) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(base, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ budgetZar, alertPercent: Number(percent) || 80, pauseAtLimit: pause }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Could not save the budget");
      onSaved(body);
      setEditing(false);
      toast(budgetZar == null ? "Budget removed" : "Budget saved");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const dismiss = async (id: string) => {
    await fetch(`${base}/alerts/${id}`, { method: "DELETE" }).catch(() => {});
    onSaved({ ...data, alerts: data.alerts.filter((a) => a.id !== id) });
  };

  const used = budget.budgetZar ? budget.spentZar / budget.budgetZar : 0;
  const valid = Number(amount) > 0 && Number(percent) >= 1 && Number(percent) <= 100;

  return (
    <section className="card rise" style={{ padding: "1.25rem 1.4rem", ["--i" as string]: 2 }}>
      <div className="row-between wrap" style={{ gap: "0.75rem" }}>
        <div className="stack" style={{ gap: "0.2rem" }}>
          <span className="eyebrow">Budget</span>
          <span className="small">
            {budget.budgetZar != null
              ? `${zar(budget.spentZar)} of ${zar(budget.budgetZar)}. Alert at ${budget.alertPercent}%${budget.pauseAtLimit ? "; AI pauses when it is used up" : ""}.`
              : "No budget set for this project."}
          </span>
        </div>
        {data.canSetBudget && !editing && (
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setEditing(true)}>
            {budget.budgetZar != null ? "Change" : "Set a budget"}
          </button>
        )}
      </div>
      {budget.budgetZar != null && (
        <div className="cost-bar" data-over={used >= 1} style={{ marginTop: "0.9rem" }} aria-label={`${Math.round(used * 100)}% of the budget used`}>
          <span style={{ width: `${Math.min(100, used * 100)}%` }} />
        </div>
      )}
      {alerts.map((a) => (
        <div key={a.id} className="chat-card" data-tone={a.level === "limit" ? "bad" : "warn"} style={{ maxWidth: "none", marginTop: "0.9rem" }}>
          <span className="row" style={{ gap: "0.4rem", alignItems: "flex-start" }}>
            <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: 2 }} />
            <span className="grow">
              {a.level === "limit"
                ? `Spend reached the ${zar(a.budgetZar)} budget on ${new Date(a.createdAt).toLocaleDateString("en-ZA")}.`
                : `Spend passed the alert level (${zar(a.spendZar)} of ${zar(a.budgetZar)}) on ${new Date(a.createdAt).toLocaleDateString("en-ZA")}.`}
            </span>
            <button type="button" className="icon-btn" aria-label="Dismiss alert" style={{ width: 26, height: 26 }} onClick={() => dismiss(a.id)}>
              <X size={14} />
            </button>
          </span>
        </div>
      ))}
      {editing && (
        <form
          className="stack"
          style={{ gap: "0.85rem", marginTop: "1rem" }}
          onSubmit={(e) => {
            e.preventDefault();
            if (valid && !busy) void save(Number(amount));
          }}
        >
          <div className="row wrap" style={{ gap: "0.75rem" }}>
            <label className="field grow" style={{ minWidth: 140 }}>
              <span className="field-label">Budget, rand</span>
              <input className="input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="e.g. 500" />
            </label>
            <label className="field grow" style={{ minWidth: 120 }}>
              <span className="field-label">Alert at, %</span>
              <input className="input" inputMode="numeric" value={percent} onChange={(e) => setPercent(e.target.value)} />
            </label>
          </div>
          <label className="row small" style={{ gap: "0.5rem" }}>
            <input type="checkbox" checked={pause} onChange={(e) => setPause(e.target.checked)} />
            Pause AI on this project once the budget is used up
          </label>
          {error && <p className="small" role="alert" style={{ color: "var(--bad)" }}>{error}</p>}
          <div className="row" style={{ justifyContent: "flex-end", gap: "0.5rem" }}>
            {budget.budgetZar != null && (
              <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => save(null)}>
                Remove budget
              </button>
            )}
            <button type="button" className="btn btn-ghost" onClick={() => setEditing(false)}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={!valid || busy}>{busy ? "Saving…" : "Save"}</button>
          </div>
        </form>
      )}
    </section>
  );
}
