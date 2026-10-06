"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { LayoutGrid } from "lucide-react";
import { useStudio } from "@/components/providers/StudioProvider";
import { localPlans, serverPlans } from "@/lib/plan/client";
import { DESK_TYPES } from "@/lib/layout/check";
import { chosenLayouts } from "@/lib/layout/options";
import { levelOf, type Plan } from "@/lib/plan/geometry";
import { shortDate } from "@/lib/studio/format";

/**
 * The layout chosen in space planning, and why, at the top of the phase it
 * hands over to (P4-05): concept starts from it.
 */
export function ChosenLayoutCard({ projectId, fromPhase }: { projectId: string; fromPhase?: string }) {
  const { persistence, viewer } = useStudio();
  const backend = useMemo(() => (persistence === "server" ? serverPlans : localPlans(viewer.name)), [persistence, viewer.name]);
  const [plan, setPlan] = useState<Plan | null | undefined>(undefined);

  useEffect(() => {
    let live = true;
    backend
      .load(projectId)
      .then((state) => live && setPlan(state.plan))
      .catch(() => live && setPlan(null));
    return () => {
      live = false;
    };
  }, [backend, projectId]);

  if (!plan) return null;
  const chosen = chosenLayouts(plan);
  return (
    <section className="card layout-handoff rise" style={{ ["--i" as string]: 2 }}>
      <div className="row" style={{ gap: "0.6rem" }}>
        <span className="fact-icon"><LayoutGrid size={16} /></span>
        <span className="eyebrow grow">From {fromPhase ?? "space planning"}</span>
      </div>
      {chosen.length === 0 ? (
        <p className="small muted">
          No layout has been chosen yet.{" "}
          <Link href={`/projects/${projectId}/layout`} style={{ textDecoration: "underline" }}>See the layout options</Link>
        </p>
      ) : (
        chosen.map((l) => (
          <div key={l.id} className="stack" style={{ gap: "0.35rem" }}>
            <span className="small strong">
              {l.name}
              {plan.levels.length > 1 ? `, ${levelOf(plan, l.levelId).name}` : ""}: {l.items.filter((i) => DESK_TYPES.has(i.type)).length} desks
              {l.chosenAt ? <span className="muted" style={{ fontWeight: 400 }}>, chosen {shortDate(new Date(l.chosenAt))}</span> : null}
            </span>
            {l.notes ? <p className="small" style={{ whiteSpace: "pre-wrap" }}>{l.notes}</p> : <p className="tiny muted">No reasons were noted.</p>}
            <Link href={`/projects/${projectId}/plan?layout=${l.id}`} className="tiny strong" style={{ color: "var(--accent)" }}>
              Open it on the plan
            </Link>
          </div>
        ))
      )}
    </section>
  );
}
