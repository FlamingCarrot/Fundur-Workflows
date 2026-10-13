"use client";

import { useMemo } from "react";
import { Download, FileUp, X } from "lucide-react";
import type { Plan, PlanItem } from "@/lib/plan/geometry";
import { schedule, scheduleCsv, SCHEDULES, type ScheduleKind } from "@/lib/plan/schedules";
import type { Resolver } from "@/lib/blueprints/resolve";
import { useViewSetting } from "@/lib/view-settings/client";

/**
 * The plan's schedules (furniture, rooms, doors and windows, walls), counted
 * live from the drawing. Picking a row selects what it counts on the plan;
 * each list downloads as CSV or is kept with the project's documents.
 */

const isKind = (v: unknown): v is ScheduleKind => SCHEDULES.some((s) => s.kind === v);
const isScope = (v: unknown): v is "floor" | "all" => v === "floor" || v === "all";

export function SchedulesSheet({
  plan,
  lib,
  levelId,
  levelName,
  projectName,
  onClose,
  onPick,
  onKeep,
}: {
  plan: Plan;
  lib: Resolver;
  levelId: string;
  levelName: string;
  projectName: string;
  onClose: () => void;
  /** Selects the row's things on the plan (all on one floor). */
  onPick: (targets: PlanItem[]) => void;
  onKeep?: (file: File) => Promise<void>;
}) {
  const [kind, setKind] = useViewSetting<ScheduleKind>("plan.schedule", "furniture", isKind);
  const [scope, setScope] = useViewSetting<"floor" | "all">("plan.schedule.scope", "floor", isScope);
  const s = useMemo(() => schedule(plan, kind, lib, scope === "floor" ? levelId : undefined), [plan, kind, lib, scope, levelId]);
  const fileName = `${projectName} ${s.title}${scope === "floor" ? ` ${levelName}` : ""}.csv`.replace(/[\\/:*?"<>|]+/g, "-");
  const csvFile = () => new File(["﻿" + scheduleCsv(s)], fileName, { type: "text/csv" });
  const download = () => {
    const url = URL.createObjectURL(csvFile());
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2_000);
  };
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="sheet plan-schedules" role="dialog" aria-label="Schedules" onKeyDown={(e) => e.key === "Escape" && onClose()}>
        <div className="row-between" style={{ marginBottom: "0.5rem" }}>
          <h2 className="display-s">Schedules</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close" autoFocus>
            <X size={18} />
          </button>
        </div>
        <div className="chip-row" role="group" aria-label="Schedule">
          {SCHEDULES.map((x) => (
            <button key={x.kind} type="button" className="chip" aria-pressed={kind === x.kind} onClick={() => setKind(x.kind)}>
              {x.label}
            </button>
          ))}
        </div>
        <div className="row-between plan-schedules-bar">
          <div className="chip-row" role="group" aria-label="Which floors">
            <button type="button" className="chip" aria-pressed={scope === "floor"} onClick={() => setScope("floor")}>{levelName}</button>
            {plan.levels.length > 1 && <button type="button" className="chip" aria-pressed={scope === "all"} onClick={() => setScope("all")}>Every floor</button>}
          </div>
          <div className="row" style={{ gap: "0.35rem" }}>
            {onKeep && (
              <button type="button" className="btn btn-secondary btn-sm" disabled={!s.rows.length} onClick={() => void onKeep(csvFile())}>
                <FileUp size={15} /> Keep in files
              </button>
            )}
            <button type="button" className="btn btn-secondary btn-sm" disabled={!s.rows.length} onClick={download}>
              <Download size={15} /> CSV
            </button>
          </div>
        </div>
        {!s.rows.length ? (
          <p className="small muted" style={{ padding: "1.5rem 0" }}>Nothing to list here yet.</p>
        ) : (
          <div className="plan-schedule-scroll">
            <table className="plan-schedule">
              <thead>
                <tr>
                  {s.columns.map((c) => (
                    <th key={c.key} className={c.numeric ? "num" : undefined}>{c.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {s.rows.map((r) => {
                  return (
                    <tr
                      key={r.key}
                      tabIndex={0}
                      title="Select these on the plan"
                      onClick={() => onPick(r.targets)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          onPick(r.targets);
                        }
                      }}
                    >
                      {s.columns.map((c) => (
                        <td key={c.key} className={c.numeric ? "num" : undefined}>{r.cells[c.key] ?? ""}</td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
              {Object.keys(s.totals).length > 0 && (
                <tfoot>
                  <tr>
                    {s.columns.map((c, i) => (
                      <td key={c.key} className={c.numeric ? "num" : undefined}>{i === 0 ? "Total" : c.key in s.totals ? s.totals[c.key] : ""}</td>
                    ))}
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}
        <p className="tiny muted" style={{ marginTop: "0.6rem" }}>Counted from the plan as it is now. Pick a row to select those things on the plan.</p>
      </div>
    </>
  );
}
