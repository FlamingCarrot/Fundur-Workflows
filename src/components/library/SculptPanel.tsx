"use client";
import { useState } from "react";
import { Brush, Layers, Waves, Minus, Focus, Hand } from "lucide-react";
import type { Part, Vec3mm } from "@/lib/blueprints/types";
import type { PointEdit } from "@/lib/blueprints/edit";
import type { SculptBrush, SymmetryAxis } from "@/lib/blueprints/mesh";
import type { BrushSettings } from "@/lib/blueprints/sculpt-session";
import "./sculpt.css";

const brushes = [
  { key: "inflate", label: "Inflate", icon: Waves, hint: "Build volume along surface normals" },
  { key: "deflate", label: "Carve", icon: Minus, hint: "Push the surface inward" },
  { key: "smooth", label: "Smooth", icon: Brush, hint: "Relax nearby vertices" },
  { key: "flatten", label: "Flatten", icon: Layers, hint: "Level the surface around the picked point" },
  { key: "pinch", label: "Pinch", icon: Focus, hint: "Draw the surface toward the brush centre" },
] as const;

export function SculptPanel({ part, center, edit, settings, onSettings, surfaceMode = false }: { part?: Part; center?: Vec3mm; edit: (e: PointEdit) => string | null; settings?: BrushSettings; onSettings?: (settings: BrushSettings) => void; surfaceMode?: boolean }) {
  const [localBrush, setLocalBrush] = useState<SculptBrush>("inflate");
  const [localRadius, setLocalRadius] = useState(Math.max(10, Math.round(Math.max(part?.size.w ?? 500, part?.size.d ?? 500, part?.size.h ?? 500) / 4)));
  const [localStrength, setLocalStrength] = useState(.2);
  const { brush, radius, strength } = settings ?? { brush: localBrush, radius: localRadius, strength: localStrength };
  const symmetry = settings?.symmetry ?? [];
  const setSymmetry = (axis: SymmetryAxis) => onSettings?.({ brush, radius, strength, symmetry: symmetry.includes(axis) ? symmetry.filter(a => a !== axis) : [...symmetry, axis] });
  const setBrush = (value: SculptBrush) => onSettings ? onSettings({ ...settings, brush: value, radius, strength }) : setLocalBrush(value);
  const setRadius = (value: number) => onSettings ? onSettings({ ...settings, brush, radius: value, strength }) : setLocalRadius(value);
  const setStrength = (value: number) => onSettings ? onSettings({ ...settings, brush, radius, strength: value }) : setLocalStrength(value);
  const [error, setError] = useState<string | null>(null);
  const apply = (e: PointEdit) => setError(edit(e));
  return <section className="sculpt-panel stack" aria-label="Sculpt brushes">
    <div className="sculpt-heading"><span className="eyebrow">Sculpt studio</span><h2 className="display-s">Shape the surface</h2><p className="small muted">{surfaceMode ? "Drag on the model with your mouse or stylus. Shift smooths; Ctrl reverses Inflate/Carve. Alt-drag or drag the background to orbit. Escape cancels. Each stroke is one undo step." : "Select one shape part, then pick a vertex in the 3D view to place your brush. Each dab is undoable. Subdivide coarse meshes for finer detail."}</p></div>
    <div className="sculpt-brushes" role="group" aria-label="Brush type">{brushes.map(b => <button key={b.key} type="button" aria-pressed={brush === b.key} onClick={() => setBrush(b.key)} title={b.hint}><b.icon size={21} /><span>{b.label}</span></button>)}</div>
    <div className="sculpt-setting"><label htmlFor="sculpt-radius">Radius <span>mm</span></label><input id="sculpt-radius" type="number" min={1} max={100000} value={radius} onChange={e => setRadius(Number(e.target.value))} /></div>
    <div className="sculpt-setting"><label htmlFor="sculpt-strength">Strength <span>{Math.round(strength * 100)}%</span></label><input id="sculpt-strength" type="range" min={.01} max={1} step={.01} value={strength} onChange={e => setStrength(Number(e.target.value))} /></div>
    {surfaceMode && onSettings && <fieldset className="sculpt-symmetry"><legend>Local symmetry</legend><div role="group" aria-label="Symmetry axes">{(["x", "y", "z"] as const).map(axis => <button key={axis} type="button" aria-pressed={symmetry.includes(axis)} onClick={() => setSymmetry(axis)} title={axis === "x" ? "Mirror left and right" : axis === "y" ? "Mirror front and back" : "Mirror top and bottom"}>{axis.toUpperCase()}</button>)}<button type="button" disabled={!symmetry.length} onClick={() => onSettings({ brush, radius, strength, symmetry: [] })}>Off</button></div><p className="tiny muted">{symmetry.length ? `Mirroring ${symmetry.map(a => a.toUpperCase()).join(" + ")} around this part’s center.` : "Enable an axis to sculpt matching sides."} The planes follow the part’s rotation and stay fixed during each stroke.</p></fieldset>}
    <div className="sculpt-target"><Hand size={16} /><span>{surfaceMode ? "Brush directly on the surface · stylus pressure supported" : center ? `Brush centre: ${center.x.toFixed(1)}, ${center.y.toFixed(1)}, ${center.z.toFixed(1)} mm` : part ? "Pick a surface vertex to position the brush" : "Select a shape part to sculpt"}</span></div>
    {!surfaceMode && <button type="button" className="btn btn-primary" disabled={!part || !!part.blueprintId || !center || radius <= 0 || radius > 100000} onClick={() => center && apply({ op: "sculpt", brush, center, radius, strength })}><Brush size={16} />Apply {brushes.find(b => b.key === brush)?.label.toLowerCase()} dab</button>}
    <button type="button" className="btn btn-secondary" disabled={!part || !!part.blueprintId} onClick={() => apply({ op: "subdivide" })}><Layers size={16} />Subdivide mesh</button>
    <p className="tiny muted">{part?.mesh ? `${part.mesh.v.length.toLocaleString()} vertices · ${part.mesh.f.length.toLocaleString()} faces` : "Shapes convert to editable meshes on the first edit."} Subdivide coarse geometry for finer brush detail. Up to 4,000 vertices per part; masks and sculpt layers are planned.</p>
    {error && <p className="small" role="alert">{error}</p>}
  </section>;
}
