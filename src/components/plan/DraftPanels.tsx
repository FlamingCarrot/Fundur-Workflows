"use client";

import React from "react";
import { Ruler, TriangleRight, Radius, Diameter, RulerDimensionLine, Scissors, MoveRight, CopyPlus, Squircle, Slash, Unlink, Circle, Eye, EyeOff, Layers as LayersIcon, Lock, LockOpen, Minus, Pentagon, Plus, RectangleHorizontal, Spline, Trash2, Type, Waypoints, Copy, MoveUpRight, Ellipsis, PaintBucket, StretchHorizontal, Compass, Crosshair, Table2, BringToFront, SendToBack, BoxSelect, Paintbrush, CopyX, Waves, Cloud, MoveDiagonal } from "lucide-react";
import { distance, mm, m2, type EditResult, type Plan, type PlanItem } from "@/lib/plan/geometry";
import { duplicate } from "@/lib/plan/elements";
import { explodeDraft, filletCorners, joinDrafts } from "@/lib/plan/draft-modify";
import { divideAlong, drawOrder, removeDuplicates, similarDrafts } from "@/lib/plan/draft-tools";
import { LIBRARY } from "@/lib/plan/library";
import {
  DEFAULT_LAYER,
  DEFAULT_TEXT_HEIGHT,
  dimensionLabel,
  draftArea,
  draftLength,
  draftName,
  drawingLayers,
  HATCH_LABEL,
  HATCHES,
  isClosed,
  layerOf,
  LINETYPE_LABEL,
  LINETYPES,
  removeDrawingLayer,
  setDrawingLayer,
  tableLayout,
  updateDraft,
  WEIGHTS,
  type Draft,
  type Hatch,
  type HatchPattern,
  type Linetype,
} from "@/lib/plan/drafting";
import { DIM_TOOLS, DRAFT_TOOLS, MODIFY_TOOLS, POLAR_STEPS, type DraftAmounts, type DraftTool, type TapeMode } from "./PlanCanvas";
import { MeasureField, Panel, TextField } from "./PlanInspector";

/**
 * The Draw tool's bar (which shape, which layer, a polygon's sides, the hatch
 * to lay), the drawing layers manager, and the side panel for a drawn shape.
 */

type Edit = (result: EditResult) => string | null;

const SHAPE_ICON: Record<DraftTool, React.ReactNode> = {
  line: <Minus size={15} />,
  polyline: <Waypoints size={15} />,
  rectangle: <RectangleHorizontal size={15} />,
  circle: <Circle size={15} />,
  arc: <Spline size={15} />,
  polygon: <Pentagon size={15} />,
  ellipse: <Ellipsis size={15} />,
  spline: <Waves size={15} />,
  cloud: <Cloud size={15} />,
  xline: <MoveDiagonal size={15} />,
  text: <Type size={15} />,
  leader: <MoveUpRight size={15} />,
  trim: <Scissors size={15} />,
  extend: <MoveRight size={15} />,
  offset: <CopyPlus size={15} />,
  fillet: <Squircle size={15} />,
  chamfer: <Slash size={15} />,
  break: <Unlink size={15} />,
  stretch: <StretchHorizontal size={15} />,
  match: <Paintbrush size={15} />,
  dimlinear: <Ruler size={15} />,
  dimangular: <TriangleRight size={15} />,
  dimradius: <Radius size={15} />,
  dimdiameter: <Diameter size={15} />,
  table: <Table2 size={15} />,
  dimchain: <RulerDimensionLine size={15} />,
};

export const DEFAULT_HATCH: Hatch = { pattern: "diagonal", scale: 150, angle: 0 };

/** The Draw tool's three sets of tools, one shown at a time so the bar stays short. */
const TOOL_GROUPS: { key: "draw" | "modify" | "dims"; label: string; tools: { key: DraftTool; label: string }[] }[] = [
  { key: "draw", label: "Draw", tools: DRAFT_TOOLS },
  { key: "modify", label: "Modify", tools: MODIFY_TOOLS },
  { key: "dims", label: "Dimension", tools: DIM_TOOLS },
];

export function DraftBar({
  plan,
  tool,
  draftTool,
  onDraftTool,
  layer,
  onLayer,
  sides,
  onSides,
  hatch,
  onHatch,
  amounts,
  onAmounts,
  onEdit,
  levelId,
}: {
  plan: Plan;
  /** The floor shown, for clearing duplicate shapes. */
  levelId?: string;
  tool: "draft" | "hatch";
  draftTool: DraftTool;
  onDraftTool: (t: DraftTool) => void;
  layer: string;
  onLayer: (id: string) => void;
  sides: number;
  onSides: (n: number) => void;
  hatch: Hatch;
  onHatch: (h: Hatch) => void;
  amounts: DraftAmounts;
  onAmounts: (a: DraftAmounts) => void;
  onEdit: Edit;
}) {
  const [layersOpen, setLayersOpen] = React.useState(false);
  const layers = drawingLayers(plan);
  const group = TOOL_GROUPS.find((g) => g.tools.some((t) => t.key === draftTool)) ?? TOOL_GROUPS[0];
  const current = layers.find((l) => l.id === layer) ?? layers[0];
  return (
    <div className="v3-wrap draft-bar">
      <div className="v3-bar" role="toolbar" aria-label={tool === "draft" ? "Shapes to draw" : "Hatch"}>
        {tool === "draft" && (
          <span className="draft-groups" role="group" aria-label="Kind of tool">
            {TOOL_GROUPS.map((g) => (
              <button key={g.key} type="button" className="v3-btn" aria-pressed={group.key === g.key} onClick={() => group.key !== g.key && onDraftTool(g.tools[0].key)}>
                <span>{g.label}</span>
              </button>
            ))}
          </span>
        )}
        {tool === "draft" && <span className="draft-bar-sep" aria-hidden />}
        {tool === "draft" &&
          group.tools.map((t) => (
            <button key={t.key} type="button" className="v3-btn" aria-pressed={draftTool === t.key} onClick={() => onDraftTool(t.key)} title={group.key === "dims" ? `${t.label} dimension` : t.label}>
              {SHAPE_ICON[t.key]}
              <span>{t.label}</span>
            </button>
          ))}
        {tool === "draft" && (draftTool === "offset" || draftTool === "fillet" || draftTool === "chamfer") && (
          <AmountField
            label={draftTool === "offset" ? "Distance" : draftTool === "fillet" ? "Radius" : "Distance"}
            value={draftTool === "offset" ? amounts.offset : draftTool === "fillet" ? amounts.radius : amounts.chamfer}
            min={draftTool === "fillet" ? 0 : 1}
            onChange={(v) => onAmounts({ ...amounts, [draftTool === "offset" ? "offset" : draftTool === "fillet" ? "radius" : "chamfer"]: v })}
          />
        )}
        {tool === "draft" && (draftTool === "line" || draftTool === "polyline" || draftTool === "leader" || draftTool === "xline" || draftTool === "stretch") && (
          <label className="draft-bar-field" title="Polar tracking: lines lock to steps of this angle. Hold Alt for any angle.">
            <Compass size={15} />
            <select className="input" value={amounts.polar ?? 45} onChange={(e) => onAmounts({ ...amounts, polar: Number(e.target.value) })} aria-label="Angle step for lines">
              {[...new Set([...POLAR_STEPS, amounts.polar ?? 45])].sort((a, b) => b - a).map((a) => <option key={a} value={a}>{a}°</option>)}
            </select>
          </label>
        )}
        {tool === "draft" && draftTool === "polygon" && (
          <label className="draft-bar-field">
            <span className="tiny muted">Sides</span>
            <input className="input tabular" type="number" min={3} max={64} value={sides} onChange={(e) => onSides(Math.max(3, Math.min(64, Math.round(Number(e.target.value) || 3))))} aria-label="Polygon sides" />
          </label>
        )}
        {tool === "hatch" && (
          <>
            <label className="draft-bar-field">
              <PaintBucket size={15} />
              <select className="input" value={hatch.pattern} onChange={(e) => onHatch({ ...hatch, pattern: e.target.value as HatchPattern })} aria-label="Hatch pattern">
                {HATCHES.map((h) => <option key={h} value={h}>{HATCH_LABEL[h]}</option>)}
              </select>
            </label>
            <label className="draft-bar-field">
              <span className="tiny muted">Repeat</span>
              <input className="input tabular" type="number" min={10} max={10000} step={10} value={hatch.scale} onChange={(e) => onHatch({ ...hatch, scale: Math.max(10, Number(e.target.value) || 10) })} aria-label="Hatch repeat in mm" />
              <span className="tiny muted">mm</span>
            </label>
            <label className="draft-bar-field">
              <span className="tiny muted">Angle</span>
              <input className="input tabular" type="number" step={15} value={hatch.angle} onChange={(e) => onHatch({ ...hatch, angle: Number(e.target.value) || 0 })} aria-label="Hatch angle in degrees" />
              <span className="tiny muted">°</span>
            </label>
          </>
        )}
        <label className="draft-bar-field">
          <i className="draft-swatch" style={{ background: current.color }} aria-hidden />
          <select className="input" value={current.id} onChange={(e) => onLayer(e.target.value)} aria-label="Drawing layer for new shapes">
            {layers.map((l) => <option key={l.id} value={l.id}>{l.name}{l.hidden ? " (hidden)" : l.locked ? " (locked)" : ""}</option>)}
          </select>
        </label>
        <button type="button" className="v3-btn" aria-expanded={layersOpen} onClick={() => setLayersOpen((o) => !o)}>
          <LayersIcon size={15} />
          <span>Drawing layers</span>
        </button>
        {levelId && tool === "draft" && (
          <button
            type="button"
            className="v3-btn"
            title="Remove shapes drawn twice in the same place on this floor, as CAD's Overkill does"
            onClick={() => {
              const r = removeDuplicates(plan, levelId);
              if (r.ok && !r.summary) onEdit({ ok: false, error: "No duplicate shapes on this floor." });
              else onEdit(r);
            }}
          >
            <CopyX size={15} />
            <span>Remove duplicates</span>
          </button>
        )}
      </div>
      {layersOpen && (
        <div className="v3-panel draft-layers" role="dialog" aria-label="Drawing layers" onKeyDown={(e) => e.key === "Escape" && setLayersOpen(false)}>
          <DrawingLayers plan={plan} onEdit={onEdit} current={current.id} onCurrent={onLayer} />
        </div>
      )}
    </div>
  );
}

/** AutoCAD's Divide and Measure: points or furniture along the shape, in equal parts or at a set step. */
function DivideFields({ plan, d, onEdit }: { plan: Plan; d: Draft; onEdit: Edit }) {
  const [mode, setMode] = React.useState<"count" | "every">("count");
  const [amount, setAmount] = React.useState(4);
  const [item, setItem] = React.useState("");
  const [align, setAlign] = React.useState(false);
  return (
    <div className="stack" style={{ gap: "0.4rem" }}>
      <span className="field-label">Place along it</span>
      <div className="row" style={{ gap: "0.4rem", flexWrap: "wrap", alignItems: "center" }}>
        <select className="input" style={{ width: "auto" }} value={mode} onChange={(e) => { setMode(e.target.value as "count" | "every"); setAmount(e.target.value === "count" ? 4 : 1200); }} aria-label="Divide or measure">
          <option value="count">In equal parts</option>
          <option value="every">Every so many mm</option>
        </select>
        <input className="input tabular" style={{ width: "6rem" }} type="number" min={mode === "count" ? 2 : 1} max={mode === "count" ? 200 : 100000} value={amount} onChange={(e) => setAmount(Number(e.target.value) || 0)} aria-label={mode === "count" ? "Parts" : "Step in mm"} />
        <select className="input" style={{ width: "auto" }} value={item} onChange={(e) => setItem(e.target.value)} aria-label="What to place">
          <option value="">Point marks</option>
          {LIBRARY.map((l) => <option key={l.type} value={l.type}>{l.name}</option>)}
        </select>
        {item && (
          <label className="row small" style={{ gap: "0.3rem" }}>
            <input type="checkbox" checked={align} onChange={(e) => setAlign(e.target.checked)} /> Follow the line
          </label>
        )}
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => onEdit(divideAlong(plan, d.id, mode === "count" ? { count: Math.round(amount) } : { every: amount }, { ...(item ? { item } : {}), ...(align ? { align } : {}) }))}>
          <Ruler size={14} /> {mode === "count" ? "Divide" : "Measure"}
        </button>
      </div>
    </div>
  );
}

/** A table's words in a grid to type into, and its rows, columns and sizes. */
function TableFields({ d, set }: { d: Draft; set: (patch: Parameters<typeof updateDraft>[2]) => string | null }) {
  const { xs, rowHeight, height } = tableLayout(d);
  const cols = xs.length - 1;
  const widths = xs.slice(1).map((x, i) => Math.round((x - xs[i]) * 10) / 10);
  const rows = (d.cells ?? [[""]]).map((r) => Array.from({ length: cols }, (_, c) => r[c] ?? ""));
  const setCell = (r: number, c: number, v: string) => set({ cells: rows.map((row, i) => (i === r ? row.map((x, j) => (j === c ? v : x)) : row)) });
  const k = `${d.id}-${height}-${rowHeight}`;
  return (
    <div className="stack" style={{ gap: "0.6rem" }}>
      <div className="draft-table-scroll">
        <div className="draft-table-grid" style={{ gridTemplateColumns: `repeat(${cols}, minmax(5.5rem, 1fr))` }}>
          {rows.map((row, r) =>
            row.map((v, c) => (
              <input
                key={`${r}-${c}-${v}`}
                className="input"
                defaultValue={v}
                maxLength={200}
                data-heading={r === 0 || undefined}
                aria-label={r === 0 ? `Heading ${c + 1}` : `Row ${r}, column ${c + 1}`}
                onBlur={(e) => {
                  if (e.target.value !== v) setCell(r, c, e.target.value);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.currentTarget.blur();
                }}
              />
            ))
          )}
        </div>
      </div>
      <div className="row" style={{ gap: "0.4rem", flexWrap: "wrap" }}>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => set({ cells: [...rows, Array(cols).fill("")] })}>
          <Plus size={14} /> Row
        </button>
        <button type="button" className="btn btn-secondary btn-sm" disabled={rows.length <= 1} onClick={() => set({ cells: rows.slice(0, -1) })}>
          <Minus size={14} /> Row
        </button>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => set({ cells: rows.map((r) => [...r, ""]), widths: [...widths, widths[widths.length - 1] ?? height * 10] })}>
          <Plus size={14} /> Column
        </button>
        <button type="button" className="btn btn-secondary btn-sm" disabled={cols <= 1} onClick={() => set({ cells: rows.map((r) => r.slice(0, -1)), widths: widths.slice(0, -1) })}>
          <Minus size={14} /> Column
        </button>
      </div>
      <div className="row" style={{ gap: "0.5rem", flexWrap: "wrap" }}>
        <MeasureField key={`h-${k}`} label="Text height" value={height} onCommit={(v) => (v > 0 ? set({ height: v }) : "More than 0 mm.")} />
        <MeasureField key={`r-${k}`} label="Row height" value={rowHeight} onCommit={(v) => (v > 0 ? set({ rowHeight: v }) : "More than 0 mm.")} />
        {widths.map((w, i) => (
          <MeasureField key={`w-${k}-${i}-${w}`} label={`Column ${i + 1}`} value={w} onCommit={(v) => (v > 0 ? set({ widths: widths.map((x, j) => (j === i ? v : x)) }) : "More than 0 mm.")} />
        ))}
      </div>
    </div>
  );
}

const TAPE_MODES: { key: TapeMode; label: string; icon: React.ReactNode }[] = [
  { key: "distance", label: "Distance", icon: <Ruler size={15} /> },
  { key: "area", label: "Area", icon: <Pentagon size={15} /> },
  { key: "point", label: "Point", icon: <Crosshair size={15} /> },
];

/** The Tape tool's bar: a distance between two points, the area and perimeter of an outline, or where a point is. */
export function TapeBar({ mode, onMode }: { mode: TapeMode; onMode: (m: TapeMode) => void }) {
  return (
    <div className="v3-wrap draft-bar">
      <div className="v3-bar" role="toolbar" aria-label="What to measure">
        {TAPE_MODES.map((t) => (
          <button key={t.key} type="button" className="v3-btn" aria-pressed={mode === t.key} onClick={() => onMode(t.key)}>
            {t.icon}
            <span>{t.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/** Rounds or cuts every corner of a polyline at once, as CAD's Fillet with Polyline does. */
function RoundCorners({ plan, d, onEdit }: { plan: Plan; d: Draft; onEdit: Edit }) {
  const [size, setSize] = React.useState(100);
  return (
    <div className="row" style={{ gap: "0.4rem", flexWrap: "wrap", alignItems: "flex-end" }}>
      <MeasureField label="Corners" value={size} onCommit={(v) => { if (!(v > 0)) return "More than 0 mm."; setSize(v); return null; }} />
      <button type="button" className="btn btn-secondary btn-sm" onClick={() => onEdit(filletCorners(plan, d.id, { radius: size }))}>
        <Squircle size={14} /> Round
      </button>
      <button type="button" className="btn btn-secondary btn-sm" onClick={() => onEdit(filletCorners(plan, d.id, { chamfer: [size, size] }))}>
        <Slash size={14} /> Cut
      </button>
    </div>
  );
}

/** A length in mm for a Modify tool, kept as typed until it is a number. */
function AmountField({ label, value, min, onChange }: { label: string; value: number; min: number; onChange: (v: number) => void }) {
  return (
    <label className="draft-bar-field">
      <span className="tiny muted">{label}</span>
      <input
        className="input tabular"
        type="number"
        min={min}
        max={100000}
        step={10}
        value={value}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (Number.isFinite(v) && v >= min && v <= 100000) onChange(v);
        }}
        aria-label={`${label} in mm`}
      />
      <span className="tiny muted">mm</span>
    </label>
  );
}

/** The layers palette: name, colour, line type, weight, shown and locked, as in CAD. */
export function DrawingLayers({ plan, onEdit, current, onCurrent }: { plan: Plan; onEdit: Edit; current?: string; onCurrent?: (id: string) => void }) {
  const layers = drawingLayers(plan);
  const counts = new Map<string, number>();
  for (const d of plan.drafts ?? []) counts.set(d.layer ?? DEFAULT_LAYER, (counts.get(d.layer ?? DEFAULT_LAYER) ?? 0) + 1);
  const [error, setError] = React.useState<string | null>(null);
  const run = (r: EditResult) => setError(onEdit(r));
  return (
    <div className="stack" style={{ gap: "0.6rem" }}>
      <div className="row-between">
        <h2 className="display-s">Drawing layers</h2>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={() => {
            let n = layers.length + 1;
            while (layers.some((l) => l.name === `Layer ${n}`)) n++;
            const r = setDrawingLayer(plan, { name: `Layer ${n}` });
            run(r);
            if (r.ok && r.id) onCurrent?.(r.id);
          }}
        >
          <Plus size={14} /> Add
        </button>
      </div>
      <p className="tiny muted">New shapes go on the layer marked as current. A shape follows its layer&apos;s colour, line type and weight unless you set its own.</p>
      {error && <p className="tiny" role="alert" style={{ color: "var(--bad)" }}>{error}</p>}
      <ul className="draft-layer-list">
        {layers.map((l) => (
          <li key={l.id} data-current={l.id === current || undefined}>
            <input type="color" className="draft-colour" value={l.color} onChange={(e) => run(setDrawingLayer(plan, { id: l.id, color: e.target.value }))} aria-label={`${l.name} colour`} />
            <input
              key={`${l.id}-${l.name}`}
              className="input draft-layer-name"
              defaultValue={l.name}
              aria-label="Layer name"
              onBlur={(e) => e.target.value.trim() !== l.name && run(setDrawingLayer(plan, { id: l.id, name: e.target.value }))}
              onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
            />
            <select className="input" value={l.linetype} onChange={(e) => run(setDrawingLayer(plan, { id: l.id, linetype: e.target.value as Linetype }))} aria-label={`${l.name} line type`}>
              {LINETYPES.map((t) => <option key={t} value={t}>{LINETYPE_LABEL[t]}</option>)}
            </select>
            <select className="input" value={l.weight} onChange={(e) => run(setDrawingLayer(plan, { id: l.id, weight: Number(e.target.value) }))} aria-label={`${l.name} line weight`}>
              {[...new Set([...WEIGHTS, l.weight])].sort((a, b) => a - b).map((w) => <option key={w} value={w}>{w} mm</option>)}
            </select>
            <span className="draft-layer-actions">
              <button type="button" className="icon-btn" aria-pressed={!l.hidden} aria-label={l.hidden ? `Show ${l.name}` : `Hide ${l.name}`} title={l.hidden ? "Show" : "Hide"} onClick={() => run(setDrawingLayer(plan, { id: l.id, hidden: !l.hidden }))}>
                {l.hidden ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
              <button type="button" className="icon-btn" aria-pressed={!!l.locked} aria-label={l.locked ? `Unlock ${l.name}` : `Lock ${l.name}`} title={l.locked ? "Unlock" : "Lock: nothing on it can be picked"} onClick={() => run(setDrawingLayer(plan, { id: l.id, locked: !l.locked }))}>
                {l.locked ? <Lock size={15} /> : <LockOpen size={15} />}
              </button>
              {onCurrent && (
                <button type="button" className="btn btn-ghost btn-sm" aria-pressed={l.id === current} onClick={() => onCurrent(l.id)}>
                  {l.id === current ? "Current" : "Use"}
                </button>
              )}
              {l.id !== DEFAULT_LAYER && (
                <button type="button" className="icon-btn" aria-label={`Remove ${l.name}`} title={counts.get(l.id) ? `Remove; its ${counts.get(l.id)} shapes move to Drafting` : "Remove"} onClick={() => run(removeDrawingLayer(plan, l.id))}>
                  <Trash2 size={15} />
                </button>
              )}
            </span>
            <span className="tiny muted draft-layer-count">{counts.get(l.id) ?? 0}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const BY_LAYER = "";

/** The side panel for one drawn shape. */
export function DraftPanel({ plan, draftId, onEdit, onSelect, onSelectMany, onRemove, onClose }: { plan: Plan; draftId: string; onEdit: Edit; onSelect: (t: PlanItem | null) => void; onSelectMany?: (items: PlanItem[]) => void; onRemove: () => void; onClose: () => void }) {
  const d = plan.drafts?.find((x) => x.id === draftId);
  if (!d) return null;
  const set = (patch: Parameters<typeof updateDraft>[2]) => onEdit(updateDraft(plan, d.id, patch));
  const layer = layerOf(plan, d);
  const closed = isClosed(d);
  const length = draftLength(d);
  const area = draftArea(d);
  return (
    <Panel title={draftName(d)} onClose={onClose} onRemove={onRemove}>
      <div className="row" style={{ gap: "1.5rem", flexWrap: "wrap" }}>
        {d.shape !== "text" && d.shape !== "dimension" && d.shape !== "table" && (
          <div className="stack" style={{ gap: "0.15rem" }}>
            <span className="eyebrow">{closed ? "Perimeter" : "Length"}</span>
            <span className="display-s tabular">{mm(length)}</span>
          </div>
        )}
        {closed && (
          <div className="stack" style={{ gap: "0.15rem" }}>
            <span className="eyebrow">Area</span>
            <span className="display-s tabular">{m2(area / 1e6)}</span>
          </div>
        )}
      </div>
      <Geometry plan={plan} d={d} set={set} />
      <label className="field">
        <span className="field-label">Layer</span>
        <select className="input" value={layer.id} onChange={(e) => set({ layer: e.target.value === DEFAULT_LAYER ? null : e.target.value })}>
          {drawingLayers(plan).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
      </label>
      <div className="row" style={{ gap: "0.5rem", flexWrap: "wrap", alignItems: "flex-end" }}>
        <label className="field" style={{ flex: "1 1 7rem" }}>
          <span className="field-label">Colour</span>
          <span className="row" style={{ gap: "0.4rem" }}>
            <input type="color" className="draft-colour" value={d.color ?? layer.color} onChange={(e) => set({ color: e.target.value })} aria-label="Colour" />
            {d.color ? (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => set({ color: null })}>By layer</button>
            ) : (
              <span className="tiny muted">By layer</span>
            )}
          </span>
        </label>
        <label className="field" style={{ flex: "1 1 7rem" }}>
          <span className="field-label">Line type</span>
          <select className="input" value={d.linetype ?? BY_LAYER} onChange={(e) => set({ linetype: e.target.value ? (e.target.value as Linetype) : null })}>
            <option value={BY_LAYER}>By layer ({LINETYPE_LABEL[layer.linetype].toLowerCase()})</option>
            {LINETYPES.map((t) => <option key={t} value={t}>{LINETYPE_LABEL[t]}</option>)}
          </select>
        </label>
        <label className="field" style={{ flex: "1 1 7rem" }}>
          <span className="field-label">Weight</span>
          <select className="input" value={d.weight ?? BY_LAYER} onChange={(e) => set({ weight: e.target.value ? Number(e.target.value) : null })}>
            <option value={BY_LAYER}>By layer ({layer.weight} mm)</option>
            {WEIGHTS.map((w) => <option key={w} value={w}>{w} mm</option>)}
          </select>
        </label>
      </div>
      {closed && <HatchFields d={d} set={set} />}
      {d.shape === "polyline" && d.points.length >= 3 && (
        <label className="row-between small">
          Closed
          <button type="button" role="switch" aria-checked={!!d.closed} className="switch" aria-label="Closed" onClick={() => set(d.closed ? { closed: false, fill: null } : { closed: true })} />
        </label>
      )}
      <div className="row" style={{ gap: "0.4rem", flexWrap: "wrap" }}>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={() => {
            const result = duplicate(plan, { kind: "draft", id: d.id });
            if (!onEdit(result) && result.ok) onSelect({ kind: "draft", id: result.id! });
          }}
        >
          <Copy size={14} /> Copy
        </button>
        {(d.shape === "polyline" || d.shape === "leader" || d.shape === "table") && (
          <button type="button" className="btn btn-secondary btn-sm" title={d.shape === "table" ? "Break it into lines and text" : "Break it into its lines and arcs"} onClick={() => onEdit(explodeDraft(plan, d.id))}>
            <Unlink size={14} /> Explode
          </button>
        )}
        {(d.shape === "line" || d.shape === "arc" || (d.shape === "polyline" && !d.closed)) && (
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            title="Join it with the lines and arcs that meet it end to end into one polyline"
            onClick={() => {
              const ids = [d.id, ...(plan.drafts ?? []).filter((x) => x.id !== d.id && x.levelId === d.levelId).map((x) => x.id)];
              const result = joinDrafts(plan, ids);
              if (!onEdit(result) && result.ok) onSelect({ kind: "draft", id: d.id });
            }}
          >
            <Waypoints size={14} /> Join
          </button>
        )}
      </div>
      {d.shape === "polyline" && d.points.length >= 3 && <RoundCorners plan={plan} d={d} onEdit={onEdit} />}
      <div className="row" style={{ gap: "0.4rem", flexWrap: "wrap" }}>
        <button type="button" className="btn btn-ghost btn-sm" title="Draw it on top of the other shapes" onClick={() => onEdit(drawOrder(plan, [d.id], "front"))}>
          <BringToFront size={14} /> Front
        </button>
        <button type="button" className="btn btn-ghost btn-sm" title="Draw it under the other shapes" onClick={() => onEdit(drawOrder(plan, [d.id], "back"))}>
          <SendToBack size={14} /> Back
        </button>
        {onSelectMany && (
          <button type="button" className="btn btn-ghost btn-sm" title="Select every shape of this kind on this layer" onClick={() => onSelectMany(similarDrafts(plan, d.id).map((id) => ({ kind: "draft" as const, id })))}>
            <BoxSelect size={14} /> Select similar
          </button>
        )}
      </div>
      {d.shape !== "text" && d.shape !== "dimension" && d.shape !== "table" && <DivideFields plan={plan} d={d} onEdit={onEdit} />}
    </Panel>
  );
}

function HatchFields({ d, set }: { d: Draft; set: (patch: Parameters<typeof updateDraft>[2]) => string | null }) {
  const fill = d.fill;
  return (
    <div className="stack" style={{ gap: "0.5rem" }}>
      <label className="field">
        <span className="field-label">Hatch</span>
        <select className="input" value={fill?.pattern ?? ""} onChange={(e) => set({ fill: e.target.value ? { ...(fill ?? DEFAULT_HATCH), pattern: e.target.value as HatchPattern } : null })}>
          <option value="">None</option>
          {HATCHES.map((h) => <option key={h} value={h}>{HATCH_LABEL[h]}</option>)}
        </select>
      </label>
      {fill && (
        <div className="row" style={{ gap: "0.5rem" }}>
          <MeasureField key={`hs-${d.id}-${fill.scale}`} label="Repeat" value={fill.scale} onCommit={(v) => set({ fill: { ...fill, scale: v } })} />
          <MeasureField key={`ha-${d.id}-${fill.angle}`} label="Angle" unit="°" value={fill.angle} onCommit={(v) => set({ fill: { ...fill, angle: v } })} />
        </div>
      )}
    </div>
  );
}

/** Exact sizes for each kind of shape. */
function Geometry({ plan, d, set }: { plan: Plan; d: Draft; set: (patch: Parameters<typeof updateDraft>[2]) => string | null }) {
  void plan;
  const k = `${d.id}-${JSON.stringify(d.points).length}-${d.radius}-${d.radius2}-${d.start}-${d.end}-${d.rotation}-${d.height}`;
  switch (d.shape) {
    case "line": {
      const [a, b] = d.points;
      const len = distance(a, b);
      const angle = Math.round(((Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI) * 10) / 10;
      const towards = (l: number, deg: number) => ({ x: a.x + Math.cos((deg * Math.PI) / 180) * l, y: a.y + Math.sin((deg * Math.PI) / 180) * l });
      return (
        <div className="row" style={{ gap: "0.5rem" }}>
          <MeasureField key={`l-${k}-${len}`} label="Length" value={Math.round(len * 10) / 10} onCommit={(v) => (v > 0 ? set({ points: [a, towards(v, angle)] }) : "Type a length above 0.")} />
          <MeasureField key={`a-${k}-${angle}`} label="Angle" unit="°" value={angle} onCommit={(v) => set({ points: [a, towards(len, v)] })} />
        </div>
      );
    }
    case "circle":
      return <MeasureField key={`r-${k}`} label="Radius" value={d.radius ?? 0} onCommit={(v) => set({ radius: v })} />;
    case "arc":
      return (
        <div className="stack" style={{ gap: "0.5rem" }}>
          <MeasureField key={`r-${k}`} label="Radius" value={d.radius ?? 0} onCommit={(v) => set({ radius: v })} />
          <div className="row" style={{ gap: "0.5rem" }}>
            <MeasureField key={`s-${k}`} label="Starts at" unit="°" value={d.start ?? 0} onCommit={(v) => set({ start: v })} />
            <MeasureField key={`e-${k}`} label="Ends at" unit="°" value={d.end ?? 0} onCommit={(v) => set({ end: v })} />
          </div>
        </div>
      );
    case "ellipse":
      return (
        <div className="row" style={{ gap: "0.5rem", flexWrap: "wrap" }}>
          <MeasureField key={`r-${k}`} label="Width" value={2 * (d.radius ?? 0)} onCommit={(v) => set({ radius: v / 2 })} />
          <MeasureField key={`r2-${k}`} label="Depth" value={2 * (d.radius2 ?? 0)} onCommit={(v) => set({ radius2: v / 2 })} />
          <MeasureField key={`t-${k}`} label="Turned" unit="°" value={d.rotation ?? 0} onCommit={(v) => set({ rotation: v })} />
        </div>
      );
    case "text":
    case "leader":
      return (
        <div className="stack" style={{ gap: "0.5rem" }}>
          <TextField key={`w-${d.id}-${d.text}`} label="Words" value={d.text ?? ""} onCommit={(v) => set(v.trim() ? { text: v } : d.shape === "leader" ? { text: null } : { text: d.text })} />
          <div className="row" style={{ gap: "0.5rem" }}>
            <MeasureField key={`h-${k}`} label="Text height" value={d.height ?? DEFAULT_TEXT_HEIGHT} onCommit={(v) => set({ height: v })} />
            {d.shape === "text" && <MeasureField key={`t-${k}`} label="Turned" unit="°" value={d.rotation ?? 0} onCommit={(v) => set({ rotation: v })} />}
          </div>
        </div>
      );
    case "dimension":
      return (
        <div className="stack" style={{ gap: "0.5rem" }}>
          <div className="stack" style={{ gap: "0.15rem" }}>
            <span className="eyebrow">Measures</span>
            <span className="display-s tabular">{dimensionLabel(d)}{d.dim === "angular" ? "" : " mm"}</span>
          </div>
          <TextField key={`w-${d.id}-${d.text}`} label="Words (<> is the measurement)" value={d.text ?? ""} onCommit={(v) => set(v.trim() ? { text: v } : { text: null })} />
          <MeasureField key={`h-${k}`} label="Text height" value={d.height ?? DEFAULT_TEXT_HEIGHT} onCommit={(v) => set({ height: v })} />
        </div>
      );
    case "table":
      return <TableFields d={d} set={set} />;
    case "polyline":
      return <p className="tiny muted">{d.points.length} points. Drag it to move it; the Modify tools on the selection bar turn, mirror and repeat it.</p>;
  }
}
