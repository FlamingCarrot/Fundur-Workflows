"use client";
import { useState } from "react";
import { Brush, Layers, Waves, Minus, Focus, Hand } from "lucide-react";
import type { Part, Vec3mm } from "@/lib/blueprints/types";
import type { PointEdit } from "@/lib/blueprints/edit";
import type { SculptBrush } from "@/lib/blueprints/mesh";
import "./sculpt.css";

const brushes = [
  { key: "inflate", label: "Inflate", icon: Waves, hint: "Build volume along surface normals" },
  { key: "deflate", label: "Carve", icon: Minus, hint: "Push the surface inward" },
  { key: "smooth", label: "Smooth", icon: Brush, hint: "Relax nearby vertices" },
  { key: "flatten", label: "Flatten", icon: Layers, hint: "Level the surface around the picked point" },
  { key: "pinch", label: "Pinch", icon: Focus, hint: "Draw the surface toward the brush centre" },
] as const;

export function SculptPanel({ part, center, edit }: { part?: Part; center?: Vec3mm; edit: (e: PointEdit) => string | null }) {
  const [brush, setBrush] = useState<SculptBrush>("inflate");
  const [radius, setRadius] = useState(Math.max(10, Math.round(Math.max(part?.size.w ?? 500, part?.size.d ?? 500, part?.size.h ?? 500) / 4)));
  const [strength, setStrength] = useState(.2);
  const [error, setError] = useState<string | null>(null);
  const apply = (e: PointEdit) => setError(edit(e));
  return <section className="sculpt-panel stack" aria-label="Sculpt brushes">
    <div className="sculpt-heading"><span className="eyebrow">Sculpt studio · first pass</span><h2 className="display-s">Shape the surface</h2><p className="small muted">Select one shape part, then pick a vertex in the 3D view to place your brush. Each dab is undoable. Subdivide coarse meshes for finer detail.</p></div>
    <div className="sculpt-brushes" role="group" aria-label="Brush type">{brushes.map(b => <button key={b.key} type="button" aria-pressed={brush === b.key} onClick={() => setBrush(b.key)} title={b.hint}><b.icon size={21} /><span>{b.label}</span></button>)}</div>
    <div className="sculpt-setting"><label htmlFor="sculpt-radius">Radius <span>mm</span></label><input id="sculpt-radius" type="number" min={1} max={100000} value={radius} onChange={e => setRadius(Number(e.target.value))} /></div>
    <div className="sculpt-setting"><label htmlFor="sculpt-strength">Strength <span>{Math.round(strength * 100)}%</span></label><input id="sculpt-strength" type="range" min={.01} max={1} step={.01} value={strength} onChange={e => setStrength(Number(e.target.value))} /></div>
    <div className="sculpt-target"><Hand size={16} /><span>{center ? `Brush centre: ${center.x.toFixed(1)}, ${center.y.toFixed(1)}, ${center.z.toFixed(1)} mm` : part ? "Pick a surface vertex to position the brush" : "Select a shape part to sculpt"}</span></div>
    <button type="button" className="btn btn-primary" disabled={!part || !!part.blueprintId || !center || radius <= 0 || radius > 100000} onClick={() => center && apply({ op: "sculpt", brush, center, radius, strength })}><Brush size={16} />Apply {brushes.find(b => b.key === brush)?.label.toLowerCase()} dab</button>
    <button type="button" className="btn btn-secondary" disabled={!part || !!part.blueprintId} onClick={() => apply({ op: "subdivide" })}><Layers size={16} />Subdivide mesh</button>
    <p className="tiny muted">{part?.mesh ? `${part.mesh.v.length.toLocaleString()} vertices · ${part.mesh.f.length.toLocaleString()} faces` : "Shapes convert to editable meshes on the first edit."} This release supports controlled brush dabs on meshes up to 4,000 vertices per part. Drag strokes and sculpt layers are planned.</p>
    {error && <p className="small" role="alert">{error}</p>}
  </section>;
}
