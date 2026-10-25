"use client";

import React from "react";
import { Ruler, TriangleRight, Radius, Diameter, RulerDimensionLine, Scissors, MoveRight, CopyPlus, Squircle, Slash, Unlink, Circle, Eye, EyeOff, Layers as LayersIcon, Lock, LockOpen, Minus, Pentagon, Plus, RectangleHorizontal, Spline, Trash2, Type, Waypoints, Copy, MoveUpRight, Ellipsis, PaintBucket } from "lucide-react";
import { distance, mm, m2, type EditResult, type Plan, type PlanItem } from "@/lib/plan/geometry";
import { duplicate } from "@/lib/plan/elements";
import { explodeDraft, filletCorners, joinDrafts } from "@/lib/plan/draft-modify";
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
  updateDraft,
  WEIGHTS,
  type Draft,
  type Hatch,
  type HatchPattern,
  type Linetype,
} from "@/lib/plan/drafting";
import { DIM_TOOLS, DRAFT_TOOLS, MODIFY_TOOLS, type DraftAmounts, type DraftTool } from "./PlanCanvas";
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
  text: <Type size={15} />,
  leader: <MoveUpRight size={15} />,
  trim: <Scissors size={15} />,
  extend: <MoveRight size={15} />,
  offset: <CopyPlus size={15} />,
  fillet: <Squircle size={15} />,
  chamfer: <Slash size={15} />,
  break: <Unlink size={15} />,
  dimlinear: <Ruler size={15} />,
  dimangular: <TriangleRight size={15} />,
  dimradius: <Radius size={15} />,
  dimdiameter: <Diameter size={15} />,
  dimchain: <RulerDimensionLine size={15} />,
};

export const DEFAULT_HATCH: Hatch = { pattern: "diagonal", scale: 150, angle: 0 };

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
}: {
  plan: Plan;
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
  const current = layers.find((l) => l.id === layer) ?? layers[0];
  return (
    <div className="v3-wrap draft-bar">
      <div className="v3-bar" role="toolbar" aria-label={tool === "draft" ? "Shapes to draw" : "Hatch"}>
        {tool === "draft" &&
          DRAFT_TOOLS.map((t) => (
            <button key={t.key} type="button" className="v3-btn" aria-pressed={draftTool === t.key} onClick={() => onDraftTool(t.key)} title={t.label}>
              {SHAPE_ICON[t.key]}
              <span>{t.label}</span>
            </button>
          ))}
        {tool === "draft" && <span className="draft-bar-sep" aria-hidden />}
        {tool === "draft" &&
          MODIFY_TOOLS.map((t) => (
            <button key={t.key} type="button" className="v3-btn" aria-pressed={draftTool === t.key} onClick={() => onDraftTool(t.key)} title={t.label}>
              {SHAPE_ICON[t.key]}
              <span>{t.label}</span>
            </button>
          ))}
        {tool === "draft" && <span className="draft-bar-sep" aria-hidden />}
        {tool === "draft" &&
          DIM_TOOLS.map((t) => (
            <button key={t.key} type="button" className="v3-btn" aria-pressed={draftTool === t.key} onClick={() => onDraftTool(t.key)} title={`${t.label} dimension`}>
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
      </div>
      {layersOpen && (
        <div className="v3-panel draft-layers" role="dialog" aria-label="Drawing layers" onKeyDown={(e) => e.key === "Escape" && setLayersOpen(false)}>
          <DrawingLayers plan={plan} onEdit={onEdit} current={current.id} onCurrent={onLayer} />
        </div>
      )}
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
export function DraftPanel({ plan, draftId, onEdit, onSelect, onRemove, onClose }: { plan: Plan; draftId: string; onEdit: Edit; onSelect: (t: PlanItem | null) => void; onRemove: () => void; onClose: () => void }) {
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
        {d.shape !== "text" && d.shape !== "dimension" && (
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
        {(d.shape === "polyline" || d.shape === "leader") && (
          <button type="button" className="btn btn-secondary btn-sm" title="Break it into its lines and arcs" onClick={() => onEdit(explodeDraft(plan, d.id))}>
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
    case "polyline":
      return <p className="tiny muted">{d.points.length} points. Drag it to move it; the Modify tools on the selection bar turn, mirror and repeat it.</p>;
  }
}
