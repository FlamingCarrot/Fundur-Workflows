"use client";

import React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Copy, Play, Plus, RefreshCw, Square, Trash2 } from "lucide-react";
import { useStudio } from "@/components/providers/StudioProvider";
import { WhenReady } from "@/components/ui/primitives";
import { isString, useViewSetting } from "@/lib/view-settings/client";
import { relativeTime } from "@/lib/studio/format";
import { entryMinutes, hours, isOverdue, KIND_LABEL, LEAD_STATUS_LABEL, LEAD_STATUSES, money, type BusinessDoc, type BusinessSettings, type DocKind, type Lead, type LeadStatus, type TimeEntry } from "@/lib/business/model";
import { getWorkflow } from "@/lib/workflow";
import { send, useBusinessAccess, useBusinessSettings, useDocs, useLeads, useOverview, useTime } from "./useBusiness";
import "./business.css";

const TABS = [
  ["overview", "Overview"],
  ["leads", "Enquiries"],
  ["proposal", "Proposals"],
  ["invoice", "Invoices"],
  ["purchase_order", "Orders"],
  ["time", "Time"],
  ["settings", "Settings"],
] as const;
type Tab = (typeof TABS)[number][0];
const isTab = (v: unknown): v is Tab => typeof v === "string" && TABS.some(([k]) => k === v);
const today = () => new Date().toISOString().slice(0, 10);

/**
 * The studio as a business: what it is owed and has earned, enquiries coming
 * in, proposals, invoices and supplier orders, time, and the studio's details.
 */
export function BusinessView() {
  const { ready } = useStudio();
  const access = useBusinessAccess();
  const [stored, setTab] = useViewSetting<string>("business.tab", "overview", isString);
  // A link can open a tab (the inbox links to new enquiries).
  React.useEffect(() => {
    const asked = new URLSearchParams(window.location.search).get("tab");
    if (isTab(asked)) {
      setTab(asked);
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, [setTab]);
  const tab: Tab = access.owner ? (isTab(stored) ? stored : "overview") : "time";
  return (
    <main className="page">
      <WhenReady ready={ready}>
        <header className="rise" style={{ marginBottom: "1.25rem" }}>
          <p className="eyebrow" style={{ marginBottom: "0.6rem" }}>Business</p>
          <h1 className="display-l">Run the studio.</h1>
        </header>
        {!access.server ? (
          <p className="card small muted" style={{ padding: "1.25rem" }}>The business side works once projects are saved on the server. In this demo everything stays in your browser.</p>
        ) : (
          <>
            {access.owner && (
              <div className="segmented segmented-sm biz-tabs" role="group" aria-label="Business">
                {TABS.map(([key, name]) => (
                  <button key={key} type="button" aria-pressed={tab === key} onClick={() => setTab(key)}>
                    {name}
                  </button>
                ))}
              </div>
            )}
            {tab === "overview" && <Overview onTab={setTab} />}
            {tab === "leads" && <Leads />}
            {(tab === "proposal" || tab === "invoice" || tab === "purchase_order") && <Docs kind={tab} />}
            {tab === "time" && <Time />}
            {tab === "settings" && <Settings />}
          </>
        )}
      </WhenReady>
    </main>
  );
}

function Stat({ label, value, tone, onClick }: { label: string; value: string; tone?: "bad"; onClick?: () => void }) {
  return (
    <button type="button" className="card biz-stat" data-tone={tone} onClick={onClick} style={{ textAlign: "left" }}>
      <span className="tiny muted">{label}</span>
      <strong>{value}</strong>
    </button>
  );
}

function Overview({ onTab }: { onTab: (t: Tab) => void }) {
  const { data, error } = useOverview();
  if (error) return <p className="small" style={{ color: "var(--bad)" }}>{error.message}</p>;
  if (!data) return <p className="small muted">Loading…</p>;
  const c = data.currency;
  const t = data.totals;
  return (
    <div className="stack" style={{ gap: "1.5rem" }}>
      <div className="biz-stats">
        <Stat label="Owed to you" value={money(t.outstandingCents, c)} onClick={() => onTab("invoice")} />
        <Stat label="Overdue" value={money(t.overdueCents, c)} tone={t.overdueCents ? "bad" : undefined} onClick={() => onTab("invoice")} />
        <Stat label="Time not billed yet" value={money(t.unbilledCents, c)} onClick={() => onTab("time")} />
        <Stat label="Proposals out" value={money(t.proposedCents, c)} onClick={() => onTab("proposal")} />
        <Stat label="Paid this month" value={money(t.paidThisMonthCents, c)} />
        <Stat label="Due in the next 30 days" value={money(t.expectedNext30Cents, c)} onClick={() => onTab("invoice")} />
        <Stat label="Hours this week" value={`${hours(t.minutesThisWeek)} h`} onClick={() => onTab("time")} />
        <Stat label="New enquiries" value={String(data.newLeads)} onClick={() => onTab("leads")} />
      </div>
      {data.months.some((m) => m.paidCents) && (
        <section className="stack" style={{ gap: "0.5rem" }}>
          <h2 className="eyebrow">Money in, by month</h2>
          <div className="card biz-months" role="img" aria-label={data.months.map((m) => `${m.month}: ${money(m.paidCents, c)}`).join(", ")}>
            {data.months.map((m) => {
              const top = Math.max(...data.months.map((x) => x.paidCents), 1);
              return (
                <div key={m.month} className="biz-month">
                  <span className="tiny biz-amount">{m.paidCents ? money(m.paidCents, c).replace(/[.,]00$/, "") : ""}</span>
                  <span className="biz-month-bar" style={{ height: `${Math.max(2, (Math.max(0, m.paidCents) / top) * 100)}%` }} />
                  <span className="tiny muted">{new Date(`${m.month}-15T12:00:00Z`).toLocaleDateString("en-ZA", { month: "short" })}</span>
                </div>
              );
            })}
          </div>
        </section>
      )}
      <section className="stack" style={{ gap: "0.5rem" }}>
        <h2 className="eyebrow">By project</h2>
        {data.projects.length ? (
          <div className="biz-list">
            {data.projects.map((p) => (
              <div key={p.projectId} className="card biz-row">
                <div className="biz-row-main">
                  <Link href={`/projects/${p.slug}`} className="strong truncate">{p.name}</Link>
                  <span className="tiny muted">
                    {hours(p.minutes)} h worked{p.unbilledMinutes ? ` · ${hours(p.unbilledMinutes)} h not billed (${money(p.unbilledCents, c)})` : ""}
                    {p.effectiveRateCents != null ? ` · earning ${money(p.effectiveRateCents, c)}/h` : ""}
                  </span>
                  {p.itemBudgetCents != null && (
                    <span className="tiny" style={{ color: p.itemSpecCents > p.itemBudgetCents ? "var(--bad)" : "var(--ink-3)" }}>
                      Items {money(p.itemSpecCents, c)} of {money(p.itemBudgetCents, c)} budget
                    </span>
                  )}
                </div>
                <div className="biz-row-side tiny">
                  {p.acceptedCents > 0 && <span>Fees agreed {money(p.acceptedCents, c)}</span>}
                  <span>Invoiced {money(p.invoicedCents, c)}</span>
                  <span className="biz-amount">Owed {money(p.outstandingCents, c)}</span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="small muted">Nothing yet. Log time, send a proposal or an invoice, and each project&apos;s money shows here.</p>
        )}
      </section>
    </div>
  );
}

function StatusTag({ doc }: { doc: BusinessDoc }) {
  const overdue = isOverdue(doc, today());
  const label = overdue ? "Overdue" : doc.status === "sent" && doc.paidCents > 0 ? "Part paid" : doc.status[0].toUpperCase() + doc.status.slice(1);
  return <span className="biz-status" data-status={overdue ? "overdue" : doc.status}>{label}</span>;
}

function Docs({ kind }: { kind: DocKind }) {
  const { data, error, mutate } = useDocs(kind);
  const { projects, toast } = useStudio();
  const router = useRouter();
  const [project, setProject] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const create = async () => {
    setBusy(true);
    try {
      const out = await send<{ docs: BusinessDoc[] }>("/api/business/docs", "POST", {
        kind,
        project: project || null,
        fill: project ? { time: kind === "invoice", items: false } : undefined,
      });
      if (out.docs.length === 1) router.push(`/business/docs/${out.docs[0].id}`);
      else {
        toast(`${out.docs.length} orders drafted, one per supplier`);
        mutate();
      }
    } catch (err) {
      toast((err as Error).message);
    }
    setBusy(false);
  };
  return (
    <div className="stack" style={{ gap: "1rem" }}>
      <div className="row wrap" style={{ gap: "0.5rem" }}>
        <select className="input" style={{ width: "auto", minWidth: 200 }} value={project} onChange={(e) => setProject(e.target.value)} aria-label="Project">
          <option value="">{kind === "purchase_order" ? "Choose a project" : "No project"}</option>
          {projects.filter((p) => p.status !== "complete").map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
        <button type="button" className="btn btn-primary btn-sm" disabled={busy || (kind === "purchase_order" && !project)} onClick={create}>
          <Plus size={14} /> {kind === "invoice" && project ? "Invoice unbilled time" : kind === "purchase_order" ? "Draft orders from the item register" : `New ${KIND_LABEL[kind].toLowerCase()}`}
        </button>
      </div>
      {error && <p className="small" style={{ color: "var(--bad)" }}>{error.message}</p>}
      <div className="biz-list">
        {data?.docs.map((d) => (
          <Link key={d.id} href={`/business/docs/${d.id}`} className="card biz-row">
            <div className="biz-row-main">
              <span className="strong truncate">{d.title || KIND_LABEL[d.kind]}</span>
              <span className="tiny muted">
                {d.number ?? "Draft"} · {d.party.name || "No name yet"}
                {d.projectName ? ` · ${d.projectName}` : ""}
                {d.aiDrafted && d.status === "draft" ? " · drafted by the AI" : ""}
                {d.dueDate && d.status === "sent" ? ` · due ${d.dueDate}` : ""}
              </span>
            </div>
            <div className="biz-row-side">
              <StatusTag doc={d} />
              <span className="biz-amount">{money(d.totals.totalCents, d.currency)}</span>
            </div>
          </Link>
        ))}
        {data && !data.docs.length && <p className="small muted">None yet.</p>}
      </div>
    </div>
  );
}

function Leads() {
  const { data, mutate } = useLeads();
  const { toast, receiveProject } = useStudio();
  const router = useRouter();
  const [adding, setAdding] = React.useState(false);
  const [form, setForm] = React.useState({ name: "", email: "", phone: "", company: "", budget: "", message: "" });
  const setStatus = async (lead: Lead, status: LeadStatus) => {
    try {
      await send(`/api/business/leads/${lead.id}`, "PATCH", { status });
      mutate();
    } catch (err) {
      toast((err as Error).message);
    }
  };
  const toProject = async (lead: Lead) => {
    try {
      const out = await send<{ project: { id: string } }>(`/api/business/leads/${lead.id}/project`, "POST", {});
      receiveProject(out.project as never);
      router.push(`/projects/${out.project.id}`);
    } catch (err) {
      toast((err as Error).message);
    }
  };
  const propose = async (lead: Lead) => {
    try {
      const out = await send<{ docs: BusinessDoc[] }>("/api/business/docs", "POST", { kind: "proposal", leadId: lead.id });
      router.push(`/business/docs/${out.docs[0].id}`);
    } catch (err) {
      toast((err as Error).message);
    }
  };
  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await send("/api/business/leads", "POST", { ...form, email: form.email || "unknown@example.com" });
      setAdding(false);
      setForm({ name: "", email: "", phone: "", company: "", budget: "", message: "" });
      mutate();
    } catch (err) {
      toast((err as Error).message);
    }
  };
  return (
    <div className="stack" style={{ gap: "1rem" }}>
      <p className="small muted">Share your enquiry form (Settings) on your website or socials. New enquiries land here and in your inbox.</p>
      <div>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => setAdding(!adding)}>
          <Plus size={14} /> Add an enquiry by hand
        </button>
      </div>
      {adding && (
        <form className="card biz-form" style={{ padding: "1rem" }} onSubmit={add}>
          <div className="biz-form-grid">
            {(["name", "email", "phone", "company", "budget"] as const).map((k) => (
              <input key={k} className="input" placeholder={k[0].toUpperCase() + k.slice(1)} required={k === "name"} type={k === "email" ? "email" : "text"} value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} />
            ))}
          </div>
          <textarea className="textarea" rows={3} required placeholder="What they need" value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} />
          <button type="submit" className="btn btn-primary btn-sm" style={{ justifySelf: "end" }}>Add</button>
        </form>
      )}
      <div className="biz-list">
        {data?.leads.map((l) => (
          <article key={l.id} className="card biz-row" style={{ alignItems: "flex-start" }}>
            <div className="biz-row-main">
              <span className="strong">{l.name}{l.company ? ` · ${l.company}` : ""}</span>
              <span className="tiny muted">
                {[l.email, l.phone, l.budget && `Budget ${l.budget}`].filter(Boolean).join(" · ")} · {relativeTime(l.createdAt)}
              </span>
              <p className="small pre" style={{ marginTop: "0.25rem" }}>{l.message}</p>
            </div>
            <div className="biz-row-side">
              <select aria-label="Status" value={l.status} onChange={(e) => setStatus(l, e.target.value as LeadStatus)} className="input" style={{ width: "auto", padding: "0.35rem 0.5rem" }}>
                {LEAD_STATUSES.map((s) => (
                  <option key={s} value={s}>{LEAD_STATUS_LABEL[s]}</option>
                ))}
              </select>
              {l.email && <a className="btn btn-ghost btn-sm" href={`mailto:${l.email}`}>Email</a>}
              {!l.projectSlug && <button type="button" className="btn btn-secondary btn-sm" onClick={() => propose(l)}>Proposal</button>}
              {l.projectSlug ? (
                <Link className="btn btn-ghost btn-sm" href={`/projects/${l.projectSlug}`}>Open project</Link>
              ) : (
                <button type="button" className="btn btn-primary btn-sm" onClick={() => toProject(l)}>Start project</button>
              )}
            </div>
          </article>
        ))}
        {data && !data.leads.length && <p className="small muted">No enquiries yet.</p>}
      </div>
    </div>
  );
}

/** Time worked: a timer, time logged by hand, and the list with what is billed. */
export function Time({ project }: { project?: string }) {
  const { owner } = useBusinessAccess();
  const { data, mutate } = useTime({ project, all: owner });
  const { projects, toast, getProject } = useStudio();
  const [form, setForm] = React.useState({ project: project ?? "", day: today(), hours: "1", note: "" });
  const [, tick] = React.useState(0);
  React.useEffect(() => {
    const again = () => mutate();
    window.addEventListener("fundur:timer", again);
    return () => window.removeEventListener("fundur:timer", again);
  }, [mutate]);
  React.useEffect(() => {
    if (!data?.running) return;
    const t = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, [data?.running]);
  const act = async (body: unknown) => {
    try {
      await send("/api/business/time", "POST", body);
      mutate();
      window.dispatchEvent(new Event("fundur:timer"));
    } catch (err) {
      toast((err as Error).message);
    }
  };
  const change = async (id: string, body: Record<string, unknown>) => {
    try {
      await send(`/api/business/time/${id}`, "PATCH", body);
      mutate();
    } catch (err) {
      toast((err as Error).message);
    }
  };
  const editHours = (e: TimeEntry) => {
    const r = prompt("Hours", String(hours(e.minutes)));
    const n = r == null ? NaN : Number(r.replace(",", "."));
    if (Number.isFinite(n) && n > 0) change(e.id, { minutes: Math.round(n * 60) });
  };
  const remove = async (id: string) => {
    try {
      await send(`/api/business/time/${id}`, "DELETE");
      mutate();
    } catch (err) {
      toast((err as Error).message);
    }
  };
  const phaseOf = (slug: string | null) => (slug ? getProject(slug)?.currentPhase ?? null : null);
  const phaseName = (slug: string | null, key: string | null) => {
    const p = slug ? getProject(slug) : undefined;
    return key && p ? getWorkflow(p).phases.find((x) => x.key === key)?.name ?? key : "";
  };
  const running = data?.running;
  return (
    <div className="stack" style={{ gap: "1rem" }}>
      <section className="card biz-form" style={{ padding: "1rem" }}>
        <div className="row wrap" style={{ gap: "0.5rem" }}>
          {!project && (
            <select className="input" style={{ width: "auto", minWidth: 180 }} value={form.project} onChange={(e) => setForm({ ...form, project: e.target.value })} aria-label="Project">
              <option value="">No project (studio time)</option>
              {projects.filter((p) => p.status !== "complete").map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          )}
          <input className="input" style={{ flex: "1 1 180px", width: "auto" }} placeholder="What are you working on?" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
          {running ? (
            <button type="button" className="btn btn-primary btn-sm" onClick={() => act({ action: "stop" })}>
              <Square size={13} /> Stop {Math.floor(entryMinutes(running) / 60)}:{String(entryMinutes(running) % 60).padStart(2, "0")}
            </button>
          ) : (
            <button type="button" className="btn btn-primary btn-sm" onClick={() => act({ action: "start", project: form.project || null, phaseKey: phaseOf(form.project || null), note: form.note })}>
              <Play size={13} /> Start timer
            </button>
          )}
        </div>
        <div className="row wrap" style={{ gap: "0.5rem", alignItems: "center" }}>
          <span className="tiny muted">Or log time:</span>
          <input className="input" type="date" style={{ width: "auto" }} value={form.day} onChange={(e) => setForm({ ...form, day: e.target.value })} aria-label="Day" />
          <input className="input" type="number" min={0.25} max={24} step={0.25} style={{ width: 90 }} value={form.hours} onChange={(e) => setForm({ ...form, hours: e.target.value })} aria-label="Hours" />
          <span className="tiny muted">h</span>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={!(Number(form.hours) > 0)}
            onClick={() => act({ action: "add", project: form.project || null, phaseKey: phaseOf(form.project || null), day: form.day, minutes: Math.round(Number(form.hours) * 60), note: form.note })}
          >
            Log
          </button>
        </div>
      </section>
      <div className="biz-list">
        {data?.entries.map((e) => (
          <div key={e.id} className="card biz-row">
            <div className="biz-row-main">
              <span className="small strong truncate">{e.note || (e.projectName ? "Design time" : "Studio time")}</span>
              <span className="tiny muted">
                {new Date(e.startedAt).toLocaleDateString("en-ZA", { weekday: "short", day: "numeric", month: "short" })}
                {e.projectName && !project ? ` · ${e.projectName}` : ""}
                {e.phaseKey ? ` · ${phaseName(e.projectSlug, e.phaseKey)}` : ""}
                {!e.billable ? " · not billable" : e.invoiceId ? " · billed" : ""}
              </span>
            </div>
            <div className="biz-row-side">
              {!e.invoiceId && e.endedAt ? (
                <button type="button" className="biz-amount" title="Change the hours" onClick={() => editHours(e)}>{hours(e.minutes)} h</button>
              ) : (
                <span className="biz-amount">{e.endedAt ? `${hours(e.minutes)} h` : "Running"}</span>
              )}
              {!e.invoiceId && e.endedAt && (
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => change(e.id, { billable: !e.billable })}>
                  {e.billable ? "Not billable" : "Billable"}
                </button>
              )}
              {!e.invoiceId && e.endedAt && (
                <button type="button" className="icon-btn" aria-label="Delete" onClick={() => remove(e.id)}>
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          </div>
        ))}
        {data && !data.entries.length && <p className="small muted">No time logged yet.</p>}
      </div>
    </div>
  );
}

function Settings() {
  const { data, mutate } = useBusinessSettings();
  const { toast } = useStudio();
  const [draft, setDraft] = React.useState<BusinessSettings | null>(null);
  const s = draft ?? data?.settings;
  if (!s || !data) return <p className="small muted">Loading…</p>;
  const set = <K extends keyof BusinessSettings>(k: K, v: BusinessSettings[K]) => setDraft({ ...s, [k]: v });
  const save = async () => {
    try {
      await send("/api/business/settings", "PUT", s);
      setDraft(null);
      mutate();
      toast("Saved");
    } catch (err) {
      toast((err as Error).message);
    }
  };
  const resetLink = async () => {
    if (!confirm("Make a new link? The old one stops working.")) return;
    await send("/api/business/settings", "POST");
    mutate();
  };
  const text = (k: keyof BusinessSettings, label: string, area = false) => (
    <label className="field">
      <span className="field-label">{label}</span>
      {area ? (
        <textarea className="textarea" rows={3} value={String(s[k])} onChange={(e) => set(k, e.target.value as never)} />
      ) : (
        <input className="input" value={String(s[k])} onChange={(e) => set(k, e.target.value as never)} />
      )}
    </label>
  );
  return (
    <div className="stack" style={{ gap: "1.25rem", maxWidth: 760 }}>
      <section className="card biz-form" style={{ padding: "1.1rem" }}>
        <h2 className="eyebrow">Enquiry form</h2>
        <p className="small muted">Put this link on your website, Instagram or email signature. Enquiries go to Business → Enquiries.</p>
        <div className="row wrap" style={{ gap: "0.5rem" }}>
          <input className="input" readOnly value={data.enquiryLink} style={{ flex: "1 1 260px", width: "auto" }} onFocus={(e) => e.target.select()} />
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => navigator.clipboard?.writeText(data.enquiryLink).then(() => toast("Copied"))}>
            <Copy size={14} /> Copy
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={resetLink}>
            <RefreshCw size={14} /> New link
          </button>
        </div>
      </section>
      <section className="card biz-form" style={{ padding: "1.1rem" }}>
        <h2 className="eyebrow">Your studio</h2>
        <div className="biz-form-grid">
          {text("studioName", "Studio name")}
          {text("email", "Email")}
          {text("phone", "Phone")}
          {text("registration", "Company registration number")}
        </div>
        {text("address", "Address", true)}
      </section>
      <section className="card biz-form" style={{ padding: "1.1rem" }}>
        <h2 className="eyebrow">Rates, VAT and payment</h2>
        <div className="biz-form-grid">
          <label className="field">
            <span className="field-label">Hourly rate (R)</span>
            <input className="input" type="number" min={0} value={s.hourlyRateCents / 100} onChange={(e) => set("hourlyRateCents", Math.round(Number(e.target.value) * 100))} />
          </label>
          <label className="field">
            <span className="field-label">Markup on items (%)</span>
            <input className="input" type="number" min={0} value={s.defaultMarkupPct} onChange={(e) => set("defaultMarkupPct", Number(e.target.value))} />
          </label>
          <label className="field">
            <span className="field-label">Payment terms (days)</span>
            <input className="input" type="number" min={0} value={s.paymentTermsDays} onChange={(e) => set("paymentTermsDays", Number(e.target.value))} />
          </label>
        </div>
        <label className="row-between" style={{ gap: "0.75rem" }}>
          <span className="small">VAT registered (adds VAT and prints &quot;Tax invoice&quot;)</span>
          <button type="button" role="switch" className="switch" aria-checked={s.vatRegistered} aria-label="VAT registered" onClick={() => set("vatRegistered", !s.vatRegistered)} />
        </label>
        {s.vatRegistered && (
          <div className="biz-form-grid">
            {text("vatNumber", "VAT number")}
            <label className="field">
              <span className="field-label">VAT rate (%)</span>
              <input className="input" type="number" min={0} max={50} value={s.vatRate} onChange={(e) => set("vatRate", Number(e.target.value))} />
            </label>
          </div>
        )}
        {text("bankDetails", "Bank details (printed on invoices)", true)}
      </section>
      <section className="card biz-form" style={{ padding: "1.1rem" }}>
        <h2 className="eyebrow">Proposal terms</h2>
        <p className="tiny muted">Printed on every proposal; the client accepts them when they accept online. Have your attorney check them.</p>
        <textarea className="textarea" rows={8} value={s.proposalTerms} onChange={(e) => set("proposalTerms", e.target.value)} />
        <div className="biz-form-grid">
          {text("proposalPrefix", "Proposal numbers start with")}
          {text("invoicePrefix", "Invoice numbers start with")}
          {text("orderPrefix", "Order numbers start with")}
        </div>
      </section>
      <div className="row" style={{ justifyContent: "flex-end", gap: "0.5rem" }}>
        {draft && <button type="button" className="btn btn-ghost" onClick={() => setDraft(null)}>Cancel</button>}
        <button type="button" className="btn btn-primary" disabled={!draft} onClick={save}>Save</button>
      </div>
    </div>
  );
}
