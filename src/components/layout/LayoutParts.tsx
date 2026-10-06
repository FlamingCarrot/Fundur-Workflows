"use client";

import React from "react";
import { AlertTriangle, CircleCheck } from "lucide-react";
import { ShapeList } from "@/components/plan/PlanCanvas";
import type { LayoutIssue, LayoutReport } from "@/lib/layout/check";
import { libraryItem } from "@/lib/plan/library";
import { wallBoxes, corners } from "@/lib/layout/space";
import { m2, type Item, type Plan } from "@/lib/plan/geometry";

/**
 * The pieces the layout screens share: a small drawing of an option, its
 * measures, and the list of rule breaks.
 */

const Y = (y: number) => -y;

/** A floor drawn small, with the furniture given, for option cards and the compare view. */
export function PlanThumb({ level, items, flagged, label }: { level: Plan; items: Item[]; flagged?: ReadonlySet<string>; label: string }) {
  const xs = [...level.walls.flatMap((w) => [w.a.x, w.b.x]), ...level.rooms.flatMap((r) => r.points.map((p) => p.x))];
  const ys = [...level.walls.flatMap((w) => [w.a.y, w.b.y]), ...level.rooms.flatMap((r) => r.points.map((p) => p.y))];
  if (!xs.length) return null;
  const pad = 600;
  const minX = Math.min(...xs) - pad;
  const maxX = Math.max(...xs) + pad;
  const minY = Math.min(...ys) - pad;
  const maxY = Math.max(...ys) + pad;
  return (
    <svg className="layout-thumb" viewBox={`${minX} ${Y(maxY)} ${maxX - minX} ${maxY - minY}`} role="img" aria-label={label}>
      <g className="layout-thumb-rooms">
        {level.rooms.map((r) => (
          <polygon key={r.id} points={r.points.map((p) => `${p.x},${Y(p.y)}`).join(" ")} data-usable={r.usable || undefined} />
        ))}
      </g>
      <g className="layout-thumb-walls">
        {level.walls.flatMap((w) =>
          wallBoxes(w, level.openings).map((b, i) => <polygon key={`${w.id}-${i}`} points={corners(b).map((p) => `${p.x},${Y(p.y)}`).join(" ")} />)
        )}
        {level.columns.map((c) =>
          c.round ? (
            <circle key={c.id} cx={c.at.x} cy={Y(c.at.y)} r={c.width / 2} />
          ) : (
            <rect key={c.id} x={c.at.x - c.width / 2} y={Y(c.at.y + c.depth / 2)} width={c.width} height={c.depth} />
          )
        )}
      </g>
      <g className="plan-items layout-thumb-items">
        {items.map((i) => (
          <g key={i.id} transform={`translate(${i.at.x} ${Y(i.at.y)}) rotate(${-i.rotation})`} data-flagged={flagged?.has(i.id) || undefined}>
            <ShapeList shapes={libraryItem(i.type).draw(i.width, i.depth)} />
          </g>
        ))}
      </g>
    </svg>
  );
}

const pct = (n: number) => `${Math.round(n * 100)}%`;
const metres = (mmValue: number) => `${(mmValue / 1_000).toLocaleString("en-ZA", { maximumFractionDigits: 1 })} m`;

export interface MetricRow {
  key: string;
  label: string;
  hint?: string;
  value: string;
  /** For comparing: higher is better (1), lower is better (-1), or neither (0). */
  better: 1 | -1 | 0;
  raw: number | null;
}

/** An option's measures, in the order the compare view lists them. */
export function metricRows(report: LayoutReport): MetricRow[] {
  const m = report.metrics;
  const near = m.adjacencies.length;
  return [
    { key: "score", label: "Score", hint: "Out of 100", value: String(m.score), better: 1, raw: m.score },
    {
      key: "desks",
      label: "Desks",
      hint: m.headcount ? `For ${m.headcount} people` : undefined,
      value: m.headcount ? `${m.desks} of ${m.headcount}` : String(m.desks),
      better: 1,
      raw: m.desks,
    },
    { key: "usable", label: "Usable area", hint: "Every usable room on the floor", value: m2(m.usableArea), better: 0, raw: m.usableArea },
    {
      key: "perDesk",
      label: "Area per desk",
      hint: "Usable area divided by desks",
      value: m.areaPerDesk != null ? m2(m.areaPerDesk) : "No desks",
      better: 0,
      raw: m.areaPerDesk,
    },
    {
      key: "circulation",
      label: "Circulation",
      hint: "Work rooms' floor not under furniture or chair space",
      value: pct(m.circulation),
      better: 0,
      raw: m.circulation,
    },
    {
      key: "walk",
      label: "Longest walk to a door",
      hint: "From the furthest desk",
      value: m.longestWalk != null ? metres(m.longestWalk) : "Not measured",
      better: -1,
      raw: m.longestWalk,
    },
    {
      key: "near",
      label: "Near and apart",
      hint: near ? "Pairs met" : "No pairs given",
      value: near ? `${m.adjacencies.filter((a) => a.met).length} of ${near}` : "None",
      better: 1,
      raw: near ? m.adjacencies.filter((a) => a.met).length : null,
    },
    {
      key: "teams",
      label: "Teams together",
      value: m.teams.length ? `${m.teams.filter((t) => t.together).length} of ${m.teams.length}` : "No teams",
      better: 1,
      raw: m.teams.length ? m.teams.filter((t) => t.together).length : null,
    },
    { key: "issues", label: "Rule breaks", value: String(report.issues.length), better: -1, raw: report.issues.length },
  ];
}

/** The rule breaks, each one a button that selects what it is about. */
export function IssueList({ issues, onPick, limit = 8 }: { issues: LayoutIssue[]; onPick?: (issue: LayoutIssue) => void; limit?: number }) {
  const [all, setAll] = React.useState(false);
  if (!issues.length) {
    return (
      <p className="small row" style={{ gap: "0.4rem", color: "var(--good)" }}>
        <CircleCheck size={15} /> Every clearance and route is met.
      </p>
    );
  }
  const shown = all ? issues : issues.slice(0, limit);
  return (
    <div className="stack" style={{ gap: "0.35rem" }}>
      <ul className="plan-list layout-issues">
        {shown.map((issue, i) => (
          <li key={i}>
            <button type="button" className="row small" style={{ gap: "0.45rem", textAlign: "left" }} onClick={() => onPick?.(issue)} disabled={!onPick || !issue.itemIds.length}>
              <AlertTriangle size={14} style={{ color: "var(--bad)", flex: "none" }} />
              <span>{issue.message}</span>
            </button>
          </li>
        ))}
      </ul>
      {issues.length > limit && (
        <button type="button" className="tiny strong" style={{ alignSelf: "flex-start" }} onClick={() => setAll((a) => !a)}>
          {all ? "Show fewer" : `Show all ${issues.length}`}
        </button>
      )}
    </div>
  );
}

/** Where the score comes from, part by part. */
export function ScoreParts({ report }: { report: LayoutReport }) {
  return (
    <ul className="plan-list">
      {report.metrics.scoreParts.map((p) => (
        <li key={p.label} className="row-between small">
          <span className="muted">{p.label}</span>
          <span className="tabular">
            {p.points} <span className="muted">/ {p.max}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}
