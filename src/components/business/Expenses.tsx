"use client";

import React from "react";
import { Plus, Trash2 } from "lucide-react";
import { useStudio } from "@/components/providers/StudioProvider";
import { money } from "@/lib/business/model";
import { send, useExpenses } from "./useBusiness";
import "./business.css";

const today = () => new Date().toISOString().slice(0, 10);

/** Money spent for a project, to recharge on the next invoice with the project's time. */
export function Expenses() {
  const { data, mutate } = useExpenses();
  const { projects, toast } = useStudio();
  const [form, setForm] = React.useState({ project: "", spentOn: today(), description: "", amount: "", markupPct: "0", billable: true });
  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    const amount = Number(form.amount.replace(",", "."));
    if (!(amount > 0)) return toast("Enter what it cost");
    try {
      await send("/api/business/expenses", "POST", {
        project: form.project || null,
        spentOn: form.spentOn,
        description: form.description,
        amountCents: Math.round(amount * 100),
        markupPct: Number(form.markupPct) || 0,
        billable: form.billable,
      });
      setForm({ ...form, description: "", amount: "" });
      mutate();
    } catch (err) {
      toast((err as Error).message);
    }
  };
  const remove = async (id: string) => {
    try {
      await send(`/api/business/expenses/${id}`, "DELETE");
      mutate();
    } catch (err) {
      toast((err as Error).message);
    }
  };
  return (
    <section className="stack" style={{ gap: "0.75rem", marginTop: "1.5rem" }}>
      <h2 className="eyebrow">Expenses to recharge</h2>
      <form className="card biz-form" style={{ padding: "1rem" }} onSubmit={add}>
        <div className="row wrap" style={{ gap: "0.5rem" }}>
          <select className="input" style={{ width: "auto", minWidth: 180 }} value={form.project} onChange={(e) => setForm({ ...form, project: e.target.value })} aria-label="Project">
            <option value="">No project</option>
            {projects.filter((p) => p.status !== "complete").map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <input className="input" required style={{ flex: "1 1 200px", width: "auto" }} placeholder="What it was (samples, travel, prints)" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </div>
        <div className="row wrap" style={{ gap: "0.5rem", alignItems: "center" }}>
          <input className="input" type="date" style={{ width: "auto" }} value={form.spentOn} onChange={(e) => setForm({ ...form, spentOn: e.target.value })} aria-label="Day" />
          <input className="input" inputMode="decimal" style={{ width: 120 }} placeholder="Cost (R)" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} aria-label="Cost in rand" />
          <input className="input" type="number" min={0} max={500} style={{ width: 90 }} value={form.markupPct} onChange={(e) => setForm({ ...form, markupPct: e.target.value })} aria-label="Markup %" title="Markup %" />
          <span className="tiny muted">% markup</span>
          <label className="row tiny" style={{ gap: "0.3rem" }}>
            <input type="checkbox" checked={form.billable} onChange={(e) => setForm({ ...form, billable: e.target.checked })} /> Recharge
          </label>
          <button type="submit" className="btn btn-secondary btn-sm"><Plus size={14} /> Add</button>
        </div>
      </form>
      <div className="biz-list">
        {data?.expenses.map((e) => (
          <div key={e.id} className="card biz-row">
            <div className="biz-row-main">
              <span className="small strong truncate">{e.description}</span>
              <span className="tiny muted">
                {e.spentOn}
                {e.projectName ? ` · ${e.projectName}` : ""}
                {!e.billable ? " · not recharged" : e.invoiceId ? " · billed" : e.markupPct ? ` · +${e.markupPct}%` : ""}
              </span>
            </div>
            <div className="biz-row-side">
              <span className="biz-amount">{money(e.amountCents)}</span>
              {!e.invoiceId && (
                <button type="button" className="icon-btn" aria-label="Delete" onClick={() => remove(e.id)}>
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          </div>
        ))}
        {data && !data.expenses.length && <p className="small muted">No expenses yet. Unbilled ones go on the project&apos;s next invoice.</p>}
      </div>
    </section>
  );
}
