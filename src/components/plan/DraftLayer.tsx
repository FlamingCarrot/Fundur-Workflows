"use client";

import React from "react";
import type { Plan, Point } from "@/lib/plan/geometry";
import { DEFAULT_TEXT_HEIGHT, dimensionParts, ellipsePoints, segmentsOf, styleOf, tableTexts, type Draft, type HatchPattern, type Linetype } from "@/lib/plan/drafting";

/**
 * Drafted shapes on the plan: lines, polylines, arcs, circles, ellipses, text,
 * leaders and hatches, in their layer's colour, line type and weight. The SVG
 * is in millimetres with y up written as -y, as in PlanCanvas.
 */

const Y = (y: number) => -y;

/** Dash patterns in screen pixels, scaled to mm by `px`. */
const DASHES: Record<Linetype, number[] | null> = {
  continuous: null,
  dashed: [9, 5],
  hidden: [5, 4],
  center: [16, 4, 3, 4],
  phantom: [18, 4, 3, 4, 3, 4],
  dot: [1.5, 4],
};

/** A shape's lines and arcs as an SVG path. */
export function draftPath(d: Draft): string {
  if (d.shape === "ellipse") {
    const pts = ellipsePoints(d, 96);
    return `M${pts.map((p) => `${p.x},${Y(p.y)}`).join("L")}Z`;
  }
  const segs = segmentsOf(d);
  let out = "";
  let last: Point | null = null;
  for (const s of segs) {
    if (s.t === "line") {
      if (!last || Math.abs(last.x - s.a.x) > 1e-6 || Math.abs(last.y - s.a.y) > 1e-6) out += `M${s.a.x},${Y(s.a.y)}`;
      out += `L${s.b.x},${Y(s.b.y)}`;
      last = s.b;
      continue;
    }
    const start = { x: s.c.x + s.r * Math.cos(s.a0), y: s.c.y + s.r * Math.sin(s.a0) };
    if (Math.abs(Math.abs(s.sweep) - Math.PI * 2) < 1e-9) {
      // A full circle as two half arcs, as SVG cannot draw one arc back to its start.
      const opp = { x: s.c.x - s.r * Math.cos(s.a0), y: s.c.y - s.r * Math.sin(s.a0) };
      out += `M${start.x},${Y(start.y)}A${s.r},${s.r} 0 1 0 ${opp.x},${Y(opp.y)}A${s.r},${s.r} 0 1 0 ${start.x},${Y(start.y)}`;
      last = start;
      continue;
    }
    const end = { x: s.c.x + s.r * Math.cos(s.a0 + s.sweep), y: s.c.y + s.r * Math.sin(s.a0 + s.sweep) };
    if (!last || Math.abs(last.x - start.x) > 1e-6 || Math.abs(last.y - start.y) > 1e-6) out += `M${start.x},${Y(start.y)}`;
    // Anticlockwise on the plan is clockwise on screen, where y runs down: sweep flag 0.
    out += `A${s.r},${s.r} 0 ${Math.abs(s.sweep) > Math.PI ? 1 : 0} ${s.sweep > 0 ? 0 : 1} ${end.x},${Y(end.y)}`;
    last = end;
  }
  if (d.shape === "polyline" && d.closed) out += "Z";
  return out;
}

/** Hatch patterns as SVG pattern tiles, one per shape so each keeps its own scale, angle and colour. */
function HatchDef({ id, pattern, scale, angle, color, px }: { id: string; pattern: HatchPattern; scale: number; angle: number; color: string; px: (n: number) => number }) {
  const s = Math.max(scale, px(4));
  const w = px(0.9);
  const line = (x1: number, y1: number, x2: number, y2: number, k: number) => <line key={k} x1={x1} y1={y1} x2={x2} y2={y2} stroke={color} strokeWidth={w} />;
  let tile: React.ReactNode;
  let tw = s;
  let th = s;
  switch (pattern) {
    case "solid":
      tile = <rect width={s} height={s} fill={color} fillOpacity={0.55} />;
      break;
    case "diagonal":
      tile = [line(0, s, s, 0, 0), line(-s / 2, s / 2, s / 2, -s / 2, 1), line(s / 2, s * 1.5, s * 1.5, s / 2, 2)];
      break;
    case "cross":
      tile = [line(0, s, s, 0, 0), line(0, 0, s, s, 1)];
      break;
    case "tiles":
      tile = [line(0, 0, s, 0, 0), line(0, 0, 0, s, 1)];
      break;
    case "brick":
      tw = s;
      th = s / 2;
      tile = [line(0, 0, s, 0, 0), line(0, th / 2, s, th / 2, 1), line(0, 0, 0, th / 2, 2), line(s / 2, th / 2, s / 2, th, 3)];
      break;
    case "herringbone": {
      const q = s / 4;
      tile = [line(0, 0, s / 2, s / 2, 0), line(s / 2, s / 2, s, 0, 1), line(0, s / 2, s / 2, s, 2), line(s / 2, s, s, s / 2, 3), line(q, q, q * 2, 0, 4), line(q * 3, q, q * 2, 0, 5)];
      break;
    }
    case "timber":
      tw = s * 4;
      th = s;
      tile = [line(0, 0, tw, 0, 0), line(s * 1.3, 0, s * 1.3, th, 1), line(s * 3.1, 0, s * 3.1, th, 2), <path key={3} d={`M${s * 0.2} ${th * 0.55} q ${s * 0.6} ${-th * 0.18} ${s * 1.2} 0`} stroke={color} strokeWidth={w * 0.7} fill="none" />];
      break;
    case "concrete":
      tile = [
        <circle key={0} cx={s * 0.2} cy={s * 0.3} r={px(1)} fill={color} />,
        <circle key={1} cx={s * 0.7} cy={s * 0.15} r={px(0.8)} fill={color} />,
        <circle key={2} cx={s * 0.55} cy={s * 0.75} r={px(1.1)} fill={color} />,
        <path key={3} d={`M${s * 0.15} ${s * 0.75} l ${s * 0.12} ${-s * 0.1} l ${s * 0.05} ${s * 0.14} z`} stroke={color} strokeWidth={w * 0.8} fill="none" />,
        <path key={4} d={`M${s * 0.75} ${s * 0.45} l ${s * 0.1} ${s * 0.12} l ${-s * 0.15} ${s * 0.02} z`} stroke={color} strokeWidth={w * 0.8} fill="none" />,
      ];
      break;
    case "insulation":
      tw = s;
      th = s;
      tile = <path d={`M0 ${s / 2} Q ${s / 4} 0 ${s / 2} ${s / 2} T ${s} ${s / 2}`} stroke={color} strokeWidth={w} fill="none" />;
      break;
    case "dots":
      tile = <circle cx={s / 2} cy={s / 2} r={px(1.2)} fill={color} />;
      break;
  }
  return (
    <pattern id={id} patternUnits="userSpaceOnUse" width={tw} height={th} patternTransform={`rotate(${-angle})`}>
      {tile}
    </pattern>
  );
}

function Arrow({ tip, from, size, color }: { tip: Point; from: Point; size: number; color: string }) {
  const len = Math.hypot(from.x - tip.x, from.y - tip.y) || 1;
  const u = { x: (from.x - tip.x) / len, y: (from.y - tip.y) / len };
  const n = { x: -u.y, y: u.x };
  const b = { x: tip.x + u.x * size, y: tip.y + u.y * size };
  const p = [tip, { x: b.x + n.x * size * 0.3, y: b.y + n.y * size * 0.3 }, { x: b.x - n.x * size * 0.3, y: b.y - n.y * size * 0.3 }];
  return <polygon points={p.map((q) => `${q.x},${Y(q.y)}`).join(" ")} fill={color} stroke="none" />;
}

/** One shape, as it is drawn. */
export function DraftMark({ plan, d, px, selected, preview }: { plan: Plan; d: Draft; px: (n: number) => number; selected?: boolean; preview?: boolean }) {
  const st = styleOf(plan, d);
  const color = selected ? "var(--plan-select, #2f6fed)" : st.color;
  // Weights are paper mm; on screen 0.25 mm reads as about 1.2 px, never thinner than a hairline.
  const width = px(Math.max(0.8, Math.min(5, st.weight * 4.5)));
  const dash = DASHES[st.linetype]?.map(px).join(" ");
  const common = { stroke: color, strokeWidth: width, strokeDasharray: dash, fill: "none", strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  if (d.shape === "text") {
    const h = d.height ?? DEFAULT_TEXT_HEIGHT;
    const lines = (d.text ?? "").split("\n");
    const at = d.points[0];
    return (
      <g data-draft-id={d.id} data-selected={selected || undefined} data-preview={preview || undefined}>
        <text x={at.x} y={Y(at.y)} fontSize={h} fill={color} transform={d.rotation ? `rotate(${-d.rotation} ${at.x} ${Y(at.y)})` : undefined} className="plan-draft-text">
          {lines.map((l, i) => (
            <tspan key={i} x={at.x} dy={i ? h * 1.4 : 0}>{l || " "}</tspan>
          ))}
        </text>
      </g>
    );
  }
  if (d.shape === "dimension") return <DimensionMark d={d} color={color} width={width} selected={selected} preview={preview} />;
  const path = draftPath(d);
  const fillId = d.fill ? `hatch-${d.id}` : undefined;
  return (
    <g data-draft-id={d.id} data-selected={selected || undefined} data-preview={preview || undefined}>
      {d.fill && (
        <>
          <defs>
            <HatchDef id={fillId!} pattern={d.fill.pattern} scale={d.fill.scale} angle={d.fill.angle} color={d.fill.color ?? st.color} px={px} />
          </defs>
          <path d={path} fill={`url(#${fillId})`} stroke="none" />
        </>
      )}
      <path d={path} {...common} />
      {d.shape === "table" &&
        tableTexts(d).map((t, i) => (
          <text key={i} x={t.at.x} y={Y(t.at.y)} fontSize={d.height ?? DEFAULT_TEXT_HEIGHT} fill={color} fontWeight={t.heading ? 700 : undefined} className="plan-draft-text">
            {t.value}
          </text>
        ))}
      {d.shape === "leader" && d.points.length >= 2 && (
        <>
          <Arrow tip={d.points[0]} from={d.points[1]} size={px(10)} color={color} />
          {d.text && (
            <text
              x={d.points[d.points.length - 1].x + (d.points[d.points.length - 1].x >= d.points[d.points.length - 2].x ? px(4) : -px(4))}
              y={Y(d.points[d.points.length - 1].y)}
              fontSize={d.height ?? DEFAULT_TEXT_HEIGHT}
              fill={color}
              dominantBaseline="middle"
              textAnchor={d.points[d.points.length - 1].x >= d.points[d.points.length - 2].x ? "start" : "end"}
              className="plan-draft-text"
            >
              {d.text}
            </text>
          )}
        </>
      )}
    </g>
  );
}

/** A dimension: extension and dimension lines with ticks, or an arc or radius with arrows, and its measurement. */
function DimensionMark({ d, color, width, selected, preview }: { d: Draft; color: string; width: number; selected?: boolean; preview?: boolean }) {
  const parts = dimensionParts(d);
  const h = d.height ?? DEFAULT_TEXT_HEIGHT;
  const tick = h * 0.35;
  const arcPath = (a: (typeof parts.arcs)[number]) => {
    const s = { x: a.c.x + a.r * Math.cos(a.a0), y: a.c.y + a.r * Math.sin(a.a0) };
    const e = { x: a.c.x + a.r * Math.cos(a.a0 + a.sweep), y: a.c.y + a.r * Math.sin(a.a0 + a.sweep) };
    return `M${s.x},${Y(s.y)}A${a.r},${a.r} 0 ${Math.abs(a.sweep) > Math.PI ? 1 : 0} ${a.sweep > 0 ? 0 : 1} ${e.x},${Y(e.y)}`;
  };
  const t = parts.text;
  return (
    <g data-draft-id={d.id} data-selected={selected || undefined} data-preview={preview || undefined} className="plan-draft-dim">
      {parts.lines.map(([a, b], i) => <line key={`l${i}`} x1={a.x} y1={Y(a.y)} x2={b.x} y2={Y(b.y)} stroke={color} strokeWidth={width} />)}
      {parts.arcs.map((a, i) => <path key={`a${i}`} d={arcPath(a)} stroke={color} strokeWidth={width} fill="none" />)}
      {parts.ticks.map((k, i) => {
        const a = k.angle + Math.PI / 4;
        const dx = Math.cos(a) * tick;
        const dy = Math.sin(a) * tick;
        return <line key={`t${i}`} x1={k.at.x - dx} y1={Y(k.at.y - dy)} x2={k.at.x + dx} y2={Y(k.at.y + dy)} stroke={color} strokeWidth={width * 2} />;
      })}
      {parts.arrows.map((a, i) => <Arrow key={`r${i}`} tip={a.tip} from={a.from} size={h * 0.8} color={color} />)}
      <text
        x={t.at.x}
        y={Y(t.at.y)}
        fontSize={h}
        fill={color}
        textAnchor="middle"
        transform={t.angle ? `rotate(${(-t.angle * 180) / Math.PI} ${t.at.x} ${Y(t.at.y)})` : undefined}
        className="plan-draft-text"
      >
        {t.value}
      </text>
    </g>
  );
}

/** Every visible shape on the floor, in the order drawn. */
export function DraftLayer({ plan, shown, px, selected }: { plan: Plan; shown: Draft[]; px: (n: number) => number; selected: ReadonlySet<string> }) {
  return (
    <g className="plan-drafts">
      {shown.filter((d) => !styleOf(plan, d).hidden).map((d) => (
        <DraftMark key={d.id} plan={plan} d={d} px={px} selected={selected.has(d.id)} />
      ))}
    </g>
  );
}
