import { toMesh } from "./mesh";
import type { Blueprint, Part } from "./types";
import type { BlueprintEdit } from "./edit";

/** Face material painting uses separate, editable mesh patches; no UVs required. */
export function paintFaces(bp: Blueprint, partId: string, faces: number[], material: string): BlueprintEdit {
  const part = bp.parts.find(p => p.id === partId);
  if (!part || part.blueprintId || bp.kind !== "object") return { ok: false, error: "Select a shape part to paint." };
  const mesh = toMesh(part);
  if (typeof mesh === "string" || !mesh.mesh) return { ok: false, error: "This part has no paintable faces." };
  const chosen = new Set(faces);
  if (!chosen.size || [...chosen].some(i => !Number.isInteger(i) || i < 0 || i >= mesh.mesh!.f.length)) return { ok: false, error: "Select valid faces to paint." };
  if (chosen.size === mesh.mesh.f.length) return { ok: true, blueprint: { ...bp, parts: bp.parts.map(p => p.id === partId ? { ...p, material } : p) }, partId, summary: "Painted the whole part" };
  if (bp.parts.length >= 400) return { ok: false, error: "This model has reached the 400-part limit. Paint an entire part or simplify it first." };
  const patch: Part = { ...mesh, id: crypto.randomUUID().slice(0, 8), name: `${part.name ?? "Part"} · paint`.slice(0, 120), material,
    mesh: { ...mesh.mesh, v: mesh.mesh.v.map(v => [...v]), f: mesh.mesh.f.filter((_, i) => chosen.has(i)).map(f => [...f]) } };
  const rest: Part = { ...mesh, mesh: { ...mesh.mesh, v: mesh.mesh.v.map(v => [...v]), f: mesh.mesh.f.filter((_, i) => !chosen.has(i)).map(f => [...f]) } };
  return { ok: true, blueprint: { ...bp, parts: [...bp.parts.map(p => p.id === partId ? rest : p), patch] }, partId: patch.id, summary: `Painted ${chosen.size} faces as an editable material patch` };
}
