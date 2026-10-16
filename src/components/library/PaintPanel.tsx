"use client";
import { useState } from "react";
import { Paintbrush, Palette } from "lucide-react";
import { MaterialPicker } from "./MaterialPicker";
import { MaterialFinishControls } from "./MaterialFinishControls";
import { useLibrary } from "./LibraryContext";
import type { Blueprint, Part, Material } from "@/lib/blueprints/types";
import type { Resolver } from "@/lib/blueprints/resolve";
import type { BlueprintEdit } from "@/lib/blueprints/edit";
import { paintFaces } from "@/lib/blueprints/paint";
import "./sculpt.css";

export function PaintPanel({ bp, part, faces, lib, apply }: { bp: Blueprint; part?: Part; faces: number[]; lib: Resolver; apply: (result: BlueprintEdit) => string | null }) {
  const [material, setMaterial] = useState<string | undefined>(part?.material ?? "std:terracotta-paint");
  const [error, setError] = useState<string | null>(null);
  const library = useLibrary();
  const [finish, setFinish] = useState<Partial<Material>>({ color: "#c9c3b8", roughness: .8, metalness: 0 });
  const [busy, setBusy] = useState(false);
  return <section className="sculpt-panel stack" aria-label="Model painting">
    <div className="sculpt-heading"><span className="eyebrow">Surface colour</span><h2 className="display-s">Paint with materials</h2><p className="small muted">Choose a material, then paint a whole part or select a face in the 3D point tools. Face painting creates an editable material patch with the same geometry.</p></div>
    <MaterialPicker lib={lib} label="Paint material" value={material} onChange={id => setMaterial(id ?? undefined)} />
    <div className="sculpt-target"><Palette size={17} /><span>{part ? `${part.name ?? "Selected part"} · ${faces.length} faces selected` : "Select one shape part to start"}</span></div>
    <button type="button" className="btn btn-primary" disabled={!part || !!part.blueprintId || !material || !faces.length} onClick={() => part && material && setError(apply(paintFaces(bp, part.id, faces, material)))}><Paintbrush size={16} />Paint selected faces</button>
    <button type="button" className="btn btn-secondary" disabled={!part || !material} onClick={() => part && material && setError(apply({ ok: true, blueprint: { ...bp, parts: bp.parts.map(p => p.id === part.id ? { ...p, material } : p) }, summary: "Painted part", partId: part.id }))}>Paint whole part</button>
    <p className="tiny muted">Material patches preserve the model silhouette and can be undone or recoloured. This is face and part painting; freehand texture strokes, masks and UV texture baking are planned.</p>
    <details><summary>Create a custom finish</summary><div className="stack" style={{ gap: ".8rem", paddingTop: ".8rem" }}>
      <label className="field"><span className="field-label">Base colour</span><input type="color" value={finish.color ?? "#c9c3b8"} onChange={e => setFinish(f => ({ ...f, color: e.target.value }))} /></label>
      <MaterialFinishControls value={finish} onChange={patch => setFinish(f => ({ ...f, ...patch }))} />
      <button type="button" className="btn btn-primary" disabled={busy || !part} onClick={async () => {
        if (!part) return;
        setBusy(true); setError(null);
        try {
          const made = await library.create("material", { name: `${bp.name} finish ${lib.materials.length + 1}`.slice(0, 120), category: "Other", color: "#c9c3b8", roughness: .8, metalness: 0, ...finish });
          setMaterial(made.id);
          setError(apply({ ok: true, blueprint: { ...bp, parts: bp.parts.map(p => p.id === part.id ? { ...p, material: made.id } : p) }, partId: part.id, summary: "Applied custom physical finish" }));
        } catch (err) { setError((err as Error).message); }
        finally { setBusy(false); }
      }}>{busy ? "Saving finish…" : "Save finish & paint part"}</button>
    </div></details>
    {error && <p className="small" role="alert">{error}</p>}
  </section>;
}
