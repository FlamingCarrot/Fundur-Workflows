"use client";

import React, { useEffect, useState } from "react";
import { useStudio } from "@/components/providers/StudioProvider";
import { SettingsTabs } from "./SettingsTabs";

interface TaskType {
  key: string;
  label: string;
  description: string;
  defaultTier: "top" | "worker";
}

interface Route {
  taskType: string;
  tier: "top" | "worker";
  maxRetries: number;
  custom: boolean;
}

interface Routing {
  taskTypes: TaskType[];
  routes: Route[];
}

/** These always run on the top model. */
const FIXED = new Set(["chat", "review"]);

/**
 * Cost-aware routing (P4-13, P4-14): each kind of AI work runs on the top
 * model or the cheaper worker model. Worker output is reviewed by the top
 * model and sent back with its feedback up to the retry cap, then flagged.
 */
export function RoutingView() {
  const { toast } = useStudio();
  const [routing, setRouting] = useState<Routing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/admin/ai/routes")
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error || "Could not load routing");
        setRouting(body);
      })
      .catch((err: Error) => setError(err.message));
  }, []);

  const save = async (route: Route) => {
    setSaving(route.taskType);
    setError(null);
    try {
      const res = await fetch("/api/admin/ai/routes", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskType: route.taskType, tier: route.tier, maxRetries: route.maxRetries }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Could not save");
      setRouting(body);
      toast("Routing saved");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(null);
    }
  };

  return (
    <main className="page page-narrow">
      <SettingsTabs />
      <header className="rise" style={{ marginBottom: "2rem" }}>
        <p className="eyebrow" style={{ marginBottom: "0.75rem" }}>Admin settings</p>
        <h1 className="display-l">Routing</h1>
        <p className="muted" style={{ marginTop: "0.75rem" }}>
          Send routine work to the cheaper worker model. The top model reviews what a worker does and sends it back with
          feedback until it passes, up to the retry cap; after that the work reaches the designer marked as unchecked.
        </p>
      </header>
      {error && <p className="small" role="alert" style={{ color: "var(--bad)", marginBottom: "1rem" }}>{error}</p>}
      {routing && (
        <section className="card rise" style={{ padding: "0.6rem 1.4rem", ["--i" as string]: 1 }}>
          {routing.taskTypes.map((t) => {
            const route = routing.routes.find((r) => r.taskType === t.key)!;
            const fixed = FIXED.has(t.key);
            return (
              <div key={t.key} className="route-row">
                <div className="stack" style={{ gap: "0.15rem", minWidth: 0 }}>
                  <span className="small strong">{t.label}</span>
                  <span className="tiny muted">{t.description}</span>
                </div>
                <label className="stack" style={{ gap: "0.2rem" }}>
                  <span className="tiny muted">Model</span>
                  <select
                    className="input"
                    value={route.tier}
                    disabled={fixed || saving === t.key}
                    onChange={(e) => save({ ...route, tier: e.target.value as Route["tier"] })}
                  >
                    <option value="top">Top model</option>
                    <option value="worker">Worker model</option>
                  </select>
                </label>
                <label className="stack" style={{ gap: "0.2rem" }}>
                  <span className="tiny muted">Review retries</span>
                  <select
                    className="input"
                    value={route.maxRetries}
                    disabled={fixed || route.tier === "top" || saving === t.key}
                    title={route.tier === "top" ? "Work on the top model is not reviewed again" : undefined}
                    onChange={(e) => save({ ...route, maxRetries: Number(e.target.value) })}
                  >
                    {[0, 1, 2, 3, 4, 5].map((n) => (
                      <option key={n} value={n}>{n}</option>
                    ))}
                  </select>
                </label>
              </div>
            );
          })}
        </section>
      )}
    </main>
  );
}
