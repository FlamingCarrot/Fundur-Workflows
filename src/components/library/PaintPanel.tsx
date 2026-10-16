"use client";
import { useState } from "react";
import { Paintbrush, Palette } from "lucide-react";
import { MaterialPicker } from "./MaterialPicker";
import type { Blueprint, Part } from "@/lib/blueprints/types";
import type { Resolver } from "@/lib/blueprints/resolve";
import type { BlueprintEdit } from "@/lib/blueprints/edit";
import { paintFaces } from "@/lib/blueprints/paint";
import "./sculpt.css";

export function PaintPanel({ bp, part, faces, lib, apply }: { bp: Blueprint; part?: Part; faces: number[]; lib: Resolver; apply: (result: BlueprintEdit) => string | null }) {
  const [material, setMaterial] = useState<string | undefined>(part?.material ?? "std:terracotta-paint");
  const [error, setError] = useState<string | null>(null);
  return <section className="sculpt-panel stack" aria-label="Model painting">
    <div className="sculpt-heading"><span className="eyebrow">Surface colour</span><h2 className="display-s">Paint with materials</h2><p className="small muted">Choose a material, then paint a whole part or select a face in the 3D point tools. Face painting creates an editable material patch with the same geometry.</p></div>
    <MaterialPicker lib={lib} label="Paint material" value={material} onChange={id => setMaterial(id ?? undefined)} />
    <div className="sculpt-target"><Palette size={17} /><span>{part ? `${part.name ?? "Selected part"} · ${faces.length} faces selected` : "Select one shape part to start"}</span></div>
    <button type="button" className="btn btn-primary" disabled={!part || !!part.blueprintId || !material || !faces.length} onClick={() => part && material && setError(apply(paintFaces(bp, part.id, faces, material)))}><Paintbrush size={16} />Paint selected faces</button>
    <button type="button" className="btn btn-secondary" disabled={!part || !material} onClick={() => part && material && setError(apply({ ok: true, blueprint: { ...bp, parts: bp.parts.map(p => p.id === part.id ? { ...p, material } : p) }, summary: "Painted part", partId: part.id }))}>Paint whole part</button>
    <p className="tiny muted">Material patches preserve the model silhouette and can be undone or recoloured. This is face and part painting; freehand texture strokes, masks and UV texture baking are planned.</p>
    {error && <p className="small" role="alert">{error}</p>}
  </section>;
}
