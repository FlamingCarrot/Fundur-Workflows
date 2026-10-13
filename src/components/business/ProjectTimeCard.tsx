"use client";

import React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Play, Square } from "lucide-react";
import { useStudio } from "@/components/providers/StudioProvider";
import { hours, type BusinessDoc } from "@/lib/business/model";
import type { Project } from "@/lib/studio/types";
import { send, useBusinessAccess, useTime } from "./useBusiness";
import "./business.css";

/** Time on this project on its overview: a timer, what is logged and not billed yet, and an invoice from it. */
export function ProjectTimeCard({ project }: { project: Project }) {
  const { owner } = useBusinessAccess();
  const { data, mutate } = useTime({ project: project.id, all: owner });
  const { toast } = useStudio();
  const router = useRouter();
  React.useEffect(() => {
    const again = () => mutate();
    window.addEventListener("fundur:timer", again);
    return () => window.removeEventListener("fundur:timer", again);
  }, [mutate]);
  if (!data) return null;
  const done = data.entries.filter((e) => e.endedAt);
  const total = done.reduce((s, e) => s + e.minutes, 0);
  const unbilled = done.filter((e) => e.billable && !e.invoiceId);
  const unbilledMin = unbilled.reduce((s, e) => s + e.minutes, 0);
  const runningHere = data.running?.projectSlug === project.id;
  const toggle = async () => {
    try {
      await send("/api/business/time", "POST", runningHere ? { action: "stop" } : { action: "start", project: project.id, phaseKey: project.currentPhase });
      await mutate();
      window.dispatchEvent(new Event("fundur:timer"));
    } catch (err) {
      toast((err as Error).message);
    }
  };
  const invoice = async () => {
    try {
      const out = await send<{ docs: BusinessDoc[] }>("/api/business/docs", "POST", { kind: "invoice", project: project.id, fill: { time: true, items: false } });
      router.push(`/business/docs/${out.docs[0].id}`);
    } catch (err) {
      toast((err as Error).message);
    }
  };
  return (
    <section className="card rise biz-row" style={{ padding: "0.9rem 1.1rem" }}>
      <div className="biz-row-main">
        <span className="small strong">Time</span>
        <span className="tiny muted">
          {hours(total)} h logged{owner ? "" : " by you"}
          {owner && unbilledMin ? ` · ${hours(unbilledMin)} h not billed` : ""}
        </span>
      </div>
      <div className="biz-row-side">
        {owner && unbilledMin > 0 && <button type="button" className="btn btn-ghost btn-sm" onClick={invoice}>Invoice it</button>}
        {owner && <Link href="/business" className="btn btn-ghost btn-sm">Business</Link>}
        <button type="button" className={`btn btn-sm ${runningHere ? "btn-primary" : "btn-secondary"}`} onClick={toggle}>
          {runningHere ? <><Square size={13} /> Stop</> : <><Play size={13} /> Start timer</>}
        </button>
      </div>
    </section>
  );
}
