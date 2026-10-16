"use client";
import type { Material } from "@/lib/blueprints/types";
import { FINISH_PRESETS } from "@/lib/blueprints/finishes";
import "./sculpt.css";

export function MaterialFinishControls({ value, onChange }: { value: Partial<Material>; onChange: (patch: Partial<Material>) => void }) {
  const slider = (key: "clearcoat" | "clearcoatRoughness" | "sheen" | "transmission" | "iridescence" | "subsurface", label: string) => <label className="field" key={key}><span className="field-label">{label} <span className="tabular">{Math.round((value[key] ?? 0) * 100)}%</span></span><input type="range" min={0} max={1} step={.01} value={value[key] ?? 0} onChange={e => onChange({ [key]: Number(e.target.value) })} /></label>;
  return <div className="finish-controls stack" style={{ gap: ".8rem" }}>
    <span className="eyebrow">Material studio</span>
    <div className="finish-presets" role="group" aria-label="Material finish presets">{FINISH_PRESETS.map(p => <button key={p.key} type="button" onClick={() => onChange(p.body)}>{p.label}</button>)}</div>
    <details><summary>Coating, fabric & glass</summary><div className="stack" style={{ gap: ".7rem", paddingTop: ".7rem" }}>
      {slider("clearcoat", "Clear coat")}{slider("clearcoatRoughness", "Coat roughness")}{slider("sheen", "Fabric sheen")}
      <label className="field"><span className="field-label">Sheen colour</span><input type="color" value={value.sheenColor ?? "#ffffff"} onChange={e => onChange({ sheenColor: e.target.value })} /></label>
      {slider("transmission", "Light transmission")}{slider("iridescence", "Iridescence")}
      <label className="field"><span className="field-label">Index of refraction</span><input type="number" className="input" min={1} max={2.5} step={.01} value={value.ior ?? 1.5} onChange={e => onChange({ ior: Number(e.target.value) })} /></label>
      <label className="field"><span className="field-label">Volume tint</span><input type="color" value={value.attenuationColor ?? "#ffffff"} onChange={e => onChange({ attenuationColor: e.target.value })} /></label>
      <label className="field"><span className="field-label">Tint travel distance · mm</span><input type="number" className="input" min={.01} max={1000000} step={1} value={value.attenuationDistance ?? 100} onChange={e => onChange({ attenuationDistance: Number(e.target.value) })} /></label>
    </div></details>
    <details><summary>Subsurface scattering · fast preview</summary><div className="stack" style={{ gap: ".7rem", paddingTop: ".7rem" }}>
      {slider("subsurface", "Scattering amount")}
      <label className="field"><span className="field-label">Scattering colour</span><input type="color" value={value.subsurfaceColor ?? "#ffb08a"} onChange={e => onChange({ subsurfaceColor: e.target.value })} /></label>
      <label className="field"><span className="field-label">Scattering radius · mm</span><input type="number" className="input" min={.01} max={1000} step={.1} value={value.subsurfaceRadius ?? 3} onChange={e => onChange({ subsurfaceRadius: Number(e.target.value) })} /></label>
      <p className="tiny muted">A direct-light approximation for skin, wax and jade looks. Uses a uniform thickness estimate; it does not calculate multiple scattering or measured thickness. Custom SSS is saved as metadata for rebuilding in your game engine.</p>
    </div></details>
    <label className="field"><span className="field-label">Optical thickness · mm</span><input type="number" className="input" min={0} max={10000} step={.1} value={value.thickness ?? 1} onChange={e => onChange({ thickness: Number(e.target.value) })} /></label>
  </div>;
}
