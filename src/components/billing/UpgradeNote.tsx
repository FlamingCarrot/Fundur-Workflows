"use client";

import Link from "next/link";
import { Lock } from "lucide-react";
import { PLAN_PAGE } from "./usePlan";

/** Says something is on the Paid plan, with the way to the plan page. */
export function UpgradeNote({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="card rise" style={{ padding: "1.15rem 1.3rem" }} role="note">
      <div className="row" style={{ gap: "0.75rem", alignItems: "flex-start" }}>
        <span className="fact-icon"><Lock size={16} /></span>
        <div className="stack grow" style={{ gap: "0.35rem" }}>
          <span className="strong">{title}</span>
          {children && <span className="small muted">{children}</span>}
          <Link href={PLAN_PAGE} className="btn btn-secondary btn-sm" style={{ alignSelf: "flex-start", marginTop: "0.35rem" }}>
            See plans
          </Link>
        </div>
      </div>
    </div>
  );
}
