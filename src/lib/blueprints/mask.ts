import { meshPoints, symmetricBrushCenters, toMesh, type SymmetryAxis } from "./mesh";
import type { Part, Vec3mm } from "./types";

export type MaskEdit =
  | { action: "paint" | "erase"; center: Vec3mm; radius: number; strength: number; mirrorCenters?: Vec3mm[]; symmetry?: SymmetryAxis[] }
  | { action: "clear" | "all" | "invert" | "blur" | "sharpen" };

/** Protection is an editable vertex attribute, never a change to the model's shape. */
export function editMask(part: Part, edit: MaskEdit): Part | string {
  if (part.blueprintId) return "Choose an editable shape part to mask.";
  if (edit.action === "clear" && !part.mesh?.mask) return part;
  const converted = toMesh(part);
  if (typeof converted === "string" || !converted.mesh) return typeof converted === "string" ? converted : "Choose a mesh to mask.";
  const mesh = converted.mesh;
  const previous = mesh.mask ?? mesh.v.map(() => 0);
  let weights: number[];
  if (edit.action === "paint" || edit.action === "erase") {
    if (!Number.isFinite(edit.radius) || edit.radius <= 0 || edit.radius > 100000 || !Number.isFinite(edit.strength) || edit.strength <= 0 || edit.strength > 1) return "Use a positive mask radius and strength up to 1.";
    const centers = edit.mirrorCenters ? [edit.center, ...edit.mirrorCenters] : symmetricBrushCenters(converted, edit.center, edit.symmetry ?? []);
    if (centers.length > 8 || centers.some(c => ![c.x, c.y, c.z].every(Number.isFinite))) return "Use finite mask positions and up to seven mirrored positions.";
    let touched = false;
    weights = meshPoints(converted).map((point, i) => {
      const distance = Math.min(...centers.map(c => Math.hypot(point.x - c.x, point.y - c.y, point.z - c.z)));
      if (distance >= edit.radius) return previous[i];
      touched = true;
      const t = 1 - distance / edit.radius;
      const strength = t * t * (3 - 2 * t) * edit.strength;
      return edit.action === "paint" ? previous[i] + (1 - previous[i]) * strength : previous[i] * (1 - strength);
    });
    if (!touched) return "No vertices inside the mask brush. Increase the radius or subdivide coarse geometry.";
  } else if (edit.action === "blur") {
    const adjacent = mesh.v.map(() => new Set<number>());
    for (const face of mesh.f) face.forEach((id, j) => {
      adjacent[id].add(face[(j + 1) % face.length]);
      adjacent[id].add(face[(j + face.length - 1) % face.length]);
    });
    weights = previous.map((value, i) => adjacent[i].size ? (value + [...adjacent[i]].reduce((sum, id) => sum + previous[id], 0) / adjacent[i].size) / 2 : value);
  } else {
    weights = previous.map(value => edit.action === "clear" ? 0 : edit.action === "all" ? 1 : edit.action === "invert" ? 1 - value : Math.max(0, Math.min(1, (value - .5) * 2 + .5)));
  }
  weights = weights.map(v => Math.round(v * 1e6) / 1e6);
  if (part.shape === "mesh" && weights.every((v, i) => v === previous[i])) return part;
  const next = { ...mesh };
  if (weights.some(v => v > 0)) next.mask = weights;
  else delete next.mask;
  return { ...converted, mesh: next };
}
