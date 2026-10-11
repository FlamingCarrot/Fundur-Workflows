"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Check, Minus } from "lucide-react";
import { useStudio } from "@/components/providers/StudioProvider";
import { WhenReady } from "@/components/ui/primitives";
import { MODULE_REGISTRY } from "@/lib/modules/registry";
import { describePlan, PLANS, type EffectivePlan, type PlanDefinition } from "@/lib/billing/plans";
import type { Usage } from "@/lib/billing/store";

interface BillingState {
  plan: EffectivePlan;
  usage: Usage;
  plans: PlanDefinition[];
  beta: boolean;
  payments: boolean;
}

/** Module names for the plan lists: the ones with a working screen. */
export const MODULE_NAMES: Record<string, string> = Object.fromEntries(
  Object.values(MODULE_REGISTRY)
    .filter((m) => m.status === "available")
    .map((m) => [m.key, m.name])
);

export const longDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });

export const usd = (n: number) => `$${n % 1 ? n.toFixed(2) : n}`;

export function storage(bytes: number) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}

/** What the plan in force means, in a sentence. */
export function planStatus(plan: EffectivePlan): string {
  switch (plan.reason) {
    case "beta":
      return "Fundur is free during the beta, so you have everything Paid includes at no charge.";
    case "admin":
      return "You're the platform Admin, so nothing is limited.";
    case "demo":
      return "This is the open demo, with nothing limited.";
    case "free_months":
      return plan.endsAt ? `Free months of Paid, until ${longDate(plan.endsAt)}.` : "Free months of Paid.";
    case "subscription": {
      const price = plan.monthlyUsd < plan.listUsd ? `${usd(plan.monthlyUsd)} a month (normally ${usd(plan.listUsd)})` : `${usd(plan.monthlyUsd)} a month`;
      return plan.endsAt ? `${price}, until ${longDate(plan.endsAt)}.` : `${price}.`;
    }
    case "lapsed":
      return "Your Paid time has ended, so you're on Free. Your work is all still here.";
    default:
      return "The Free plan: one project at a time, with the core of every workflow.";
  }
}

/** The person's own plan: what it is, what they use against it, and what Paid adds. */
export function SubscriptionView() {
  const { toast, persistence } = useStudio();
  const [state, setState] = useState<BillingState | null>(null);
  const [failed, setFailed] = useState(false);
  const [code, setCode] = useState("");
  const [redeeming, setRedeeming] = useState(false);

  const load = useCallback(() => {
    fetch("/api/billing", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((s: BillingState) => setState(s), () => setFailed(true));
  }, []);

  useEffect(() => {
    if (persistence === "server") load();
  }, [load, persistence]);

  const redeem = async () => {
    if (!code.trim() || redeeming) return;
    setRedeeming(true);
    try {
      const res = await fetch("/api/billing/redeem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "That code didn't work");
      toast(`Code applied: ${body.summary}`);
      setCode("");
      // The plan the whole app sees changes too, so the page reloads.
      window.location.reload();
    } catch (err) {
      toast((err as Error).message);
    } finally {
      setRedeeming(false);
    }
  };

  if (persistence !== "server") {
    return (
      <main className="page page-narrow">
        <Header />
        <p className="muted" style={{ marginBottom: "1.75rem" }}>Plans apply once you sign in. The open demo has everything switched on.</p>
        <PlanCompare plans={null} current={null} payments={false} beta />
      </main>
    );
  }

  return (
    <main className="page page-narrow">
      <Header />
      {failed && !state && <p className="small" role="alert">Your plan couldn&apos;t be loaded. Reload the page to try again.</p>}
      <WhenReady ready={!!state}>
        {state && (
          <div className="stack" style={{ gap: "1.5rem" }}>
            <section className="card rise" style={{ padding: "1.4rem 1.5rem" }}>
              <div className="row-between wrap" style={{ gap: "0.75rem" }}>
                <div className="stack" style={{ gap: "0.3rem" }}>
                  <span className="eyebrow">You&apos;re on</span>
                  <span className="display-m">{state.plan.label}</span>
                </div>
                {state.plan.reason === "beta" && <span className="tag tag-good">Free during beta</span>}
              </div>
              <p className="muted" style={{ marginTop: "0.6rem" }}>{planStatus(state.plan)}</p>
              <UsageMeters plan={state.plan} usage={state.usage} />
            </section>

            <PlanCompare plans={state.plans} current={state.plan} payments={state.payments} beta={state.beta} />

            <section className="card rise" style={{ padding: "1.25rem 1.4rem" }}>
              <form
                className="stack"
                style={{ gap: "0.6rem" }}
                onSubmit={(e) => {
                  e.preventDefault();
                  void redeem();
                }}
              >
                <label className="field-label" htmlFor="promo">Have a code?</label>
                <div className="row" style={{ gap: "0.5rem" }}>
                  <input id="promo" className="input grow" placeholder="e.g. WELCOME3" value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" />
                  <button type="submit" className="btn btn-secondary" disabled={!code.trim() || redeeming}>
                    {redeeming ? "Applying…" : "Apply"}
                  </button>
                </div>
                <span className="tiny muted">Codes give free months of Paid or money off.</span>
              </form>
            </section>
          </div>
        )}
      </WhenReady>
    </main>
  );
}

function Header() {
  return (
    <header className="rise" style={{ marginBottom: "1.75rem" }}>
      <p className="eyebrow" style={{ marginBottom: "0.75rem" }}>Account</p>
      <h1 className="display-l">Your plan</h1>
    </header>
  );
}

export function UsageMeters({ plan, usage }: { plan: EffectivePlan; usage: Usage }) {
  const l = plan.limits;
  const rows: { label: string; used: string; of: string | null; share: number | null }[] = [
    {
      label: "Projects open",
      used: String(usage.openProjects),
      of: l.openProjects == null ? null : String(l.openProjects),
      share: l.openProjects ? usage.openProjects / l.openProjects : null,
    },
    {
      label: "File storage",
      used: storage(usage.storageBytes),
      of: l.storageMb == null ? null : storage(l.storageMb * 1024 ** 2),
      share: l.storageMb ? usage.storageBytes / (l.storageMb * 1024 ** 2) : null,
    },
    {
      label: "AI this month",
      used: usd(Math.round(usage.aiUsdThisMonth * 100) / 100),
      of: l.aiUsdPerMonth == null ? null : usd(l.aiUsdPerMonth),
      share: l.aiUsdPerMonth ? usage.aiUsdThisMonth / l.aiUsdPerMonth : null,
    },
  ];
  if (plan.seats < 1000) {
    rows.push({ label: "Seats", used: String(usage.members), of: String(plan.seats), share: usage.members / plan.seats });
  }
  return (
    <div className="cost-table" style={{ marginTop: "1.1rem" }}>
      {rows.map((r) => (
        <div key={r.label} className="cost-row" style={{ flexDirection: "column", gap: "0.4rem" }}>
          <div className="row-between">
            <span>{r.label}</span>
            <span className="tabular">
              {r.used}
              {r.of && <span className="muted"> of {r.of}</span>}
            </span>
          </div>
          {r.share != null && (
            <span className="cost-bar" data-over={r.share >= 1} aria-hidden>
              <span style={{ width: `${Math.min(100, Math.round(r.share * 100))}%` }} />
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

function PlanCompare({
  plans,
  current,
  payments,
  beta,
}: {
  plans: PlanDefinition[] | null;
  current: EffectivePlan | null;
  payments: boolean;
  beta: boolean;
}) {
  const list = plans ?? Object.values(PLANS);
  return (
    <section className="rise">
      <h2 className="section-title" style={{ marginBottom: "0.85rem" }}>Plans</h2>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: "1rem" }}>
        {list.map((p) => {
          const here = current?.key === p.key;
          return (
            <article key={p.key} className="card" style={{ padding: "1.25rem 1.35rem" }} aria-current={here ? "true" : undefined}>
              <div className="row-between" style={{ marginBottom: "0.35rem" }}>
                <span className="display-s">{p.name}</span>
                {here && <span className="tag tag-me">Current</span>}
              </div>
              <p className="display-m tabular">
                {usd(p.priceUsdMonthly)}
                <span className="small muted"> / month</span>
              </p>
              <p className="small muted" style={{ margin: "0.4rem 0 0.9rem" }}>{p.tagline}</p>
              <ul className="stack" style={{ gap: "0.45rem", listStyle: "none", padding: 0, margin: 0 }}>
                {describePlan(p, MODULE_NAMES).map((line) => (
                  <li key={line.text} className="row small" style={{ gap: "0.5rem", alignItems: "flex-start", color: line.included ? undefined : "var(--ink-3)" }}>
                    {line.included ? <Check size={15} style={{ flexShrink: 0, marginTop: 2 }} /> : <Minus size={15} style={{ flexShrink: 0, marginTop: 2 }} />}
                    <span>{line.text}</span>
                  </li>
                ))}
              </ul>
              {p.key === "paid" && (
                <>
                  <p className="tiny muted" style={{ marginTop: "0.9rem" }}>
                    Add a team seat for {usd(p.seatUsdMonthly)} a month each; with one or more, Paid becomes a Team plan.
                  </p>
                  {current && current.key !== "paid" && (
                    <button type="button" className="btn btn-primary btn-block" style={{ marginTop: "0.9rem" }} disabled={!payments}>
                      {payments ? "Move to Paid" : beta ? "Free during the beta" : "Payments open soon"}
                    </button>
                  )}
                </>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
