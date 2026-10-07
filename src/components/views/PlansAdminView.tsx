"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Search, X } from "lucide-react";
import { useStudio } from "@/components/providers/StudioProvider";
import { WhenReady } from "@/components/ui/primitives";
import { relativeTime } from "@/lib/studio/format";
import type { EffectivePlan } from "@/lib/billing/plans";
import type { AccountRow, BillingSettings, PromoCode, SubscriptionEvent, Usage } from "@/lib/billing/store";
import { SettingsTabs } from "./SettingsTabs";
import { longDate, planStatus, usd, UsageMeters } from "./SubscriptionView";

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { "Content-Type": "application/json" } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
  return body as T;
}

interface AdminState {
  accounts: AccountRow[];
  codes: PromoCode[];
  settings: BillingSettings;
}

const REASON_TAG: Partial<Record<EffectivePlan["reason"], string>> = {
  beta: "Beta",
  free_months: "Free months",
  admin: "Admin",
  lapsed: "Lapsed",
};

/** The Admin's plans page: the free beta switch, every account's plan, and codes. */
export function PlansAdminView() {
  const { toast } = useStudio();
  const [state, setState] = useState<AdminState | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<AccountRow | null>(null);

  const load = useCallback((q: string) => {
    call<AdminState>(`/api/admin/billing${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ""}`).then(
      (s) => {
        setState(s);
        setFailed(null);
      },
      (err: Error) => setFailed(err.message)
    );
  }, []);

  useEffect(() => {
    const t = setTimeout(() => load(query), 250);
    return () => clearTimeout(t);
  }, [load, query]);

  const setBeta = (betaAllPaid: boolean) => {
    setState((s) => s && { ...s, settings: { betaAllPaid } });
    call("/api/admin/billing", { method: "PATCH", body: JSON.stringify({ betaAllPaid }) }).then(
      () => {
        toast(betaAllPaid ? "Everyone has Paid for free again" : "Plans now apply: Free accounts are limited");
        load(query);
      },
      (err: Error) => {
        toast(`That didn't save: ${err.message}`);
        load(query);
      }
    );
  };

  return (
    <main className="page page-narrow">
      <SettingsTabs />
      <header className="rise" style={{ marginBottom: "2rem" }}>
        <p className="eyebrow" style={{ marginBottom: "0.75rem" }}>Admin settings</p>
        <h1 className="display-l">Plans</h1>
        <p className="muted" style={{ marginTop: "0.75rem" }}>
          Free and Paid ($20 a month, $5 per extra seat, which makes it a Team plan). Assign a plan to anyone, give free
          months or a discount, and hand out codes. Payments go through Whop once it&apos;s connected; until then nobody is charged.
        </p>
      </header>

      {failed && !state && <div className="card" style={{ padding: "1.25rem 1.4rem", color: "var(--bad)" }}>{failed}</div>}

      <WhenReady ready={!!state}>
        {state && (
          <div className="stack" style={{ gap: "1.75rem" }}>
            <section className="card rise" style={{ padding: "1.2rem 1.35rem" }}>
              <div className="row-between" style={{ gap: "1rem" }}>
                <div className="stack" style={{ gap: "0.25rem" }}>
                  <span className="strong">Free beta</span>
                  <span className="small muted">
                    {state.settings.betaAllPaid
                      ? "On: every account gets Paid at no charge and nothing is limited except the AI allowance."
                      : "Off: accounts without Paid time are on Free, with its limits."}
                  </span>
                </div>
                <button
                  type="button"
                  className="switch"
                  role="switch"
                  aria-checked={state.settings.betaAllPaid}
                  aria-label="Free beta"
                  onClick={() => setBeta(!state.settings.betaAllPaid)}
                />
              </div>
            </section>

            <section className="rise">
              <div className="row-between wrap" style={{ gap: "0.75rem", marginBottom: "0.85rem" }}>
                <h2 className="section-title">Accounts</h2>
                <label className="row input" style={{ gap: "0.4rem", maxWidth: 320, flex: 1 }}>
                  <Search size={15} aria-hidden />
                  <input
                    style={{ border: "none", background: "transparent", outline: "none", flex: 1, font: "inherit", color: "inherit" }}
                    placeholder="Name, email or studio"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    aria-label="Find an account"
                  />
                </label>
              </div>
              {state.accounts.length === 0 ? (
                <p className="muted">No accounts{query ? " match that" : " yet"}.</p>
              ) : (
                <div className="card" style={{ padding: "0.35rem 0" }}>
                  {state.accounts.map((a) => (
                    <button
                      key={a.workspaceId}
                      type="button"
                      className="row-between"
                      onClick={() => setOpen(a)}
                      style={{ width: "100%", padding: "0.8rem 1.2rem", gap: "1rem", textAlign: "left", borderTop: "1px solid var(--line)" }}
                    >
                      <span className="stack" style={{ gap: "0.15rem", minWidth: 0 }}>
                        <span className="small strong truncate">{a.owner?.name || a.owner?.email || a.workspace}</span>
                        <span className="tiny muted truncate">
                          {a.owner?.email ?? "no email"} · {a.workspace} · {a.usage.openProjects} open project{a.usage.openProjects === 1 ? "" : "s"} · AI {usd(Math.round(a.usage.aiUsdThisMonth * 100) / 100)} this month
                        </span>
                      </span>
                      <span className="row" style={{ gap: "0.35rem", flexShrink: 0 }}>
                        {REASON_TAG[a.plan.reason] && <span className="tag">{REASON_TAG[a.plan.reason]}</span>}
                        <span className={`tag ${a.plan.key === "paid" ? "tag-good" : ""}`}>{a.plan.label}</span>
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </section>

            <CodesSection codes={state.codes} onChanged={() => load(query)} />
          </div>
        )}
      </WhenReady>

      {open && (
        <AccountSheet
          account={open}
          onClose={() => setOpen(null)}
          onChanged={() => load(query)}
        />
      )}
    </main>
  );
}

type Change =
  | { type: "assign"; plan: "free" | "paid"; months: number | null }
  | { type: "freeMonths"; months: number }
  | { type: "discount"; kind: "percent" | "amount"; value: number; months: number | null; note?: string | null }
  | { type: "clearDiscount" }
  | { type: "seats"; extraSeats: number };

function AccountSheet({ account, onClose, onChanged }: { account: AccountRow; onClose: () => void; onChanged: () => void }) {
  const { toast } = useStudio();
  const [detail, setDetail] = useState<{ plan: EffectivePlan; usage: Usage; events: SubscriptionEvent[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [assignMonths, setAssignMonths] = useState("0");
  const [freeMonths, setFreeMonths] = useState("3");
  const [discountKind, setDiscountKind] = useState<"percent" | "amount">("percent");
  const [discountValue, setDiscountValue] = useState("20");
  const [discountMonths, setDiscountMonths] = useState("");
  const [discountNote, setDiscountNote] = useState("");
  const [seats, setSeats] = useState<string | null>(null);

  const url = `/api/admin/billing/accounts/${account.workspaceId}`;
  useEffect(() => {
    call<typeof detail>(url).then(setDetail, (err: Error) => toast(err.message));
  }, [url, toast]);

  const send = async (change: Change, done: string) => {
    setBusy(true);
    try {
      setDetail(await call(url, { method: "POST", body: JSON.stringify(change) }));
      toast(done);
      setSeats(null);
      onChanged();
    } catch (err) {
      toast((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const sub = detail?.plan.subscription;
  const discount = sub?.discount;
  const discountRunning = discount && (!discount.until || new Date(discount.until) > new Date());
  const shownSeats = seats ?? String(sub?.extraSeats ?? 0);

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="sheet" role="dialog" aria-label={`Plan for ${account.workspace}`} style={{ maxHeight: "calc(100vh - 48px)", overflowY: "auto", width: "min(600px, calc(100vw - 24px))" }}>
        <div className="row-between" style={{ marginBottom: "0.4rem", gap: "1rem" }}>
          <h2 className="display-s truncate">{account.owner?.name || account.owner?.email || account.workspace}</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        <p className="tiny muted" style={{ marginBottom: "1rem" }}>
          {account.owner?.email ?? "no email"} · {account.workspace} · joined {longDate(account.createdAt)}
        </p>

        <WhenReady ready={!!detail}>
          {detail && sub && (
            <div className="stack" style={{ gap: "1.25rem" }}>
              <div className="well" style={{ padding: "0.9rem 1rem" }}>
                <div className="row-between">
                  <span className="strong">{detail.plan.label}</span>
                  {detail.plan.listUsd > 0 && detail.plan.reason === "subscription" && (
                    <span className="small tabular">{usd(detail.plan.monthlyUsd)} / month</span>
                  )}
                </div>
                <p className="small muted" style={{ marginTop: "0.3rem" }}>{planStatus(detail.plan)}</p>
                {sub.plan === "paid" && detail.plan.reason === "beta" && (
                  <p className="tiny muted" style={{ marginTop: "0.3rem" }}>Their own Paid time has ended; the beta covers them.</p>
                )}
                {discountRunning && (
                  <p className="tiny" style={{ marginTop: "0.3rem" }}>
                    Discount: {discount!.kind === "percent" ? `${discount!.value}% off` : `${usd(discount!.value)} off a month`}
                    {discount!.until ? ` until ${longDate(discount!.until)}` : ""}{discount!.note ? ` (${discount!.note})` : ""}
                  </p>
                )}
                <UsageMeters plan={detail.plan} usage={detail.usage} />
              </div>

              <Action title="Assign a plan">
                <div className="row wrap" style={{ gap: "0.5rem" }}>
                  <select className="input" style={{ width: "auto" }} value={assignMonths} onChange={(e) => setAssignMonths(e.target.value)} aria-label="For how long">
                    <option value="0">No end date</option>
                    {[1, 3, 6, 12, 24].map((m) => <option key={m} value={m}>For {m} month{m === 1 ? "" : "s"}</option>)}
                  </select>
                  <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => send({ type: "assign", plan: "paid", months: Number(assignMonths) || null }, "Paid assigned")}>
                    Assign Paid
                  </button>
                  <button type="button" className="btn btn-ghost btn-sm" disabled={busy || sub.plan === "free"} onClick={() => send({ type: "assign", plan: "free", months: null }, "Moved to Free")}>
                    Move to Free
                  </button>
                </div>
              </Action>

              <Action title="Give free months" hint="Paid at no charge; when they run out the account goes back to where it was.">
                <div className="row wrap" style={{ gap: "0.5rem" }}>
                  <input className="input" type="number" min={1} max={120} value={freeMonths} onChange={(e) => setFreeMonths(e.target.value)} style={{ width: 90 }} aria-label="Months" />
                  <span className="small muted">months</span>
                  <button type="button" className="btn btn-secondary btn-sm" disabled={busy || !(Number(freeMonths) >= 1)} onClick={() => send({ type: "freeMonths", months: Math.round(Number(freeMonths)) }, "Free months given")}>
                    Give
                  </button>
                </div>
              </Action>

              <Action title="Discount" hint="Off the monthly price once payments are on. Leave months empty for as long as the plan runs.">
                <div className="row wrap" style={{ gap: "0.5rem" }}>
                  <select className="input" style={{ width: "auto" }} value={discountKind} onChange={(e) => setDiscountKind(e.target.value as "percent" | "amount")} aria-label="Kind">
                    <option value="percent">% off</option>
                    <option value="amount">$ off a month</option>
                  </select>
                  <input className="input" type="number" min={1} value={discountValue} onChange={(e) => setDiscountValue(e.target.value)} style={{ width: 90 }} aria-label="Amount" />
                  <input className="input" type="number" min={1} placeholder="months" value={discountMonths} onChange={(e) => setDiscountMonths(e.target.value)} style={{ width: 100 }} aria-label="For how many months" />
                  <input className="input grow" placeholder="Note (optional)" value={discountNote} onChange={(e) => setDiscountNote(e.target.value)} aria-label="Note" />
                </div>
                <div className="row" style={{ gap: "0.5rem", marginTop: "0.5rem" }}>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    disabled={busy || !(Number(discountValue) > 0)}
                    onClick={() =>
                      send(
                        { type: "discount", kind: discountKind, value: Number(discountValue), months: Number(discountMonths) || null, note: discountNote.trim() || null },
                        "Discount set"
                      )
                    }
                  >
                    Set discount
                  </button>
                  {discount && (
                    <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => send({ type: "clearDiscount" }, "Discount removed")}>
                      Remove discount
                    </button>
                  )}
                </div>
              </Action>

              <Action title="Team seats" hint={`Extra seats beyond the owner, $5 a month each. One or more makes it a Team plan; 0 makes it plain Paid. ${detail.usage.members} in the workspace now.`}>
                <div className="row wrap" style={{ gap: "0.5rem" }}>
                  <input className="input" type="number" min={0} max={500} value={shownSeats} onChange={(e) => setSeats(e.target.value)} style={{ width: 90 }} aria-label="Extra seats" />
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    disabled={busy || seats == null || !(Number(seats) >= 0)}
                    onClick={() => send({ type: "seats", extraSeats: Math.round(Number(seats)) }, "Seats saved")}
                  >
                    Save seats
                  </button>
                </div>
              </Action>

              <div>
                <h3 className="eyebrow" style={{ marginBottom: "0.5rem" }}>History</h3>
                {detail.events.length === 0 ? (
                  <p className="small muted">No changes yet.</p>
                ) : (
                  <div className="cost-table">
                    {detail.events.map((e) => (
                      <div key={e.id} className="cost-row">
                        <span>{e.summary}</span>
                        <span className="tiny muted" style={{ flexShrink: 0 }}>{e.actor ? `${e.actor}, ` : ""}{relativeTime(e.createdAt)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </WhenReady>
      </div>
    </>
  );
}

function Action({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="stack" style={{ gap: "0.45rem" }}>
      <span className="field-label">{title}</span>
      {children}
      {hint && <span className="tiny muted">{hint}</span>}
    </div>
  );
}

function codeText(c: PromoCode) {
  const what =
    c.kind === "free_months"
      ? `${c.value} free month${c.value === 1 ? "" : "s"} of Paid`
      : `${c.kind === "percent" ? `${c.value}% off` : `${usd(c.value)} off a month`}${c.months ? ` for ${c.months} month${c.months === 1 ? "" : "s"}` : ""}`;
  const uses = c.maxRedemptions ? `${c.redemptions} of ${c.maxRedemptions} used` : `${c.redemptions} used`;
  return `${what} · ${uses}${c.expiresAt ? ` · until ${longDate(c.expiresAt)}` : ""}`;
}

function CodesSection({ codes, onChanged }: { codes: PromoCode[]; onChanged: () => void }) {
  const { toast } = useStudio();
  const [code, setCode] = useState("");
  const [kind, setKind] = useState<PromoCode["kind"]>("free_months");
  const [value, setValue] = useState("3");
  const [months, setMonths] = useState("");
  const [max, setMax] = useState("");
  const [expires, setExpires] = useState("");
  const [busy, setBusy] = useState(false);

  const create = async () => {
    setBusy(true);
    try {
      await call("/api/admin/billing/codes", {
        method: "POST",
        body: JSON.stringify({
          code,
          kind,
          value: Number(value),
          months: kind === "free_months" ? null : Number(months) || null,
          maxRedemptions: Number(max) || null,
          expiresAt: expires || null,
        }),
      });
      toast(`Code ${code.toUpperCase()} made`);
      setCode("");
      onChanged();
    } catch (err) {
      toast((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const toggle = (c: PromoCode) =>
    call(`/api/admin/billing/codes/${c.id}`, { method: "PATCH", body: JSON.stringify({ active: !c.active }) }).then(onChanged, (err: Error) =>
      toast(err.message)
    );

  return (
    <section className="rise">
      <h2 className="section-title" style={{ marginBottom: "0.35rem" }}>Codes</h2>
      <p className="small muted" style={{ marginBottom: "0.85rem" }}>
        People enter a code on their plan page. Each account can use a code once.
      </p>
      <div className="card" style={{ padding: "1.1rem 1.25rem", marginBottom: "1rem" }}>
        <form
          className="row wrap"
          style={{ gap: "0.5rem" }}
          onSubmit={(e) => {
            e.preventDefault();
            void create();
          }}
        >
          <input className="input" placeholder="CODE" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} style={{ width: 140 }} aria-label="Code" />
          <select className="input" style={{ width: "auto" }} value={kind} onChange={(e) => setKind(e.target.value as PromoCode["kind"])} aria-label="Kind">
            <option value="free_months">Free months of Paid</option>
            <option value="percent">% off</option>
            <option value="amount">$ off a month</option>
          </select>
          <input className="input" type="number" min={1} value={value} onChange={(e) => setValue(e.target.value)} style={{ width: 80 }} aria-label={kind === "free_months" ? "Months" : "Amount"} />
          {kind !== "free_months" && (
            <input className="input" type="number" min={1} placeholder="for months" value={months} onChange={(e) => setMonths(e.target.value)} style={{ width: 110 }} aria-label="For how many months" />
          )}
          <input className="input" type="number" min={1} placeholder="max uses" value={max} onChange={(e) => setMax(e.target.value)} style={{ width: 100 }} aria-label="Most times it can be used" />
          <input className="input" type="date" value={expires} onChange={(e) => setExpires(e.target.value)} style={{ width: "auto" }} aria-label="Last day it works" />
          <button type="submit" className="btn btn-primary btn-sm" disabled={busy || code.trim().length < 3 || !(Number(value) > 0)}>
            Make code
          </button>
        </form>
      </div>
      {codes.length > 0 && (
        <div className="card" style={{ padding: "0.35rem 0" }}>
          {codes.map((c) => (
            <div key={c.id} className="row-between" style={{ padding: "0.75rem 1.2rem", gap: "1rem", borderTop: "1px solid var(--line)" }}>
              <span className="stack" style={{ gap: "0.15rem", minWidth: 0, opacity: c.active ? 1 : 0.55 }}>
                <span className="small strong"><code>{c.code}</code></span>
                <span className="tiny muted">{codeText(c)}</span>
              </span>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => toggle(c)}>
                {c.active ? "Switch off" : "Switch on"}
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

