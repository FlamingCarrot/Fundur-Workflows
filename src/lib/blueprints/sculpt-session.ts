import type { Blueprint, Vec3mm } from "./types";
import { editPoints } from "./edit";
import { symmetricBrushCenters, toMesh, type SculptBrush, type SymmetryAxis } from "./mesh";
import type { Part } from "./types";

export interface BrushSettings { brush: SculptBrush; radius: number; strength: number; symmetry?: SymmetryAxis[] }
export interface BrushModifiers { pressure: number; smooth: boolean; inverse: boolean }

/** One pointer gesture owns one draft. Only its final result enters undo history. */
export class SculptSession {
  readonly before: Blueprint;
  current: Blueprint;
  dabs = 0;
  private finished = false;
  readonly frame: Part;
  constructor(blueprint: Blueprint, readonly partId: string) {
    const part = blueprint.parts.find(p => p.id === partId);
    if (!part || part.blueprintId || blueprint.kind !== "object") throw new Error("Choose an editable shape part to sculpt.");
    const frame = toMesh(part);
    if (typeof frame === "string") throw new Error(frame);
    this.frame = frame;
    this.before = this.current = blueprint;
  }
  dab(center: Vec3mm, settings: BrushSettings, modifiers: BrushModifiers): string | null {
    if (this.finished) return "This sculpt stroke has ended.";
    if (this.dabs >= 512) return "Finish this stroke before continuing.";
    if (!Number.isFinite(modifiers.pressure) || modifiers.pressure <= 0) return null;
    const brush = modifiers.smooth ? "smooth" : modifiers.inverse && settings.brush === "inflate" ? "deflate" : modifiers.inverse && settings.brush === "deflate" ? "inflate" : settings.brush;
    const centers = symmetricBrushCenters(this.frame, center, settings.symmetry ?? []);
    const result = editPoints(this.current, this.partId, { op: "sculpt", brush, center: centers[0], mirrorCenters: centers.slice(1), radius: settings.radius,
      strength: settings.strength * Math.min(1, modifiers.pressure) * .35 });
    if (!result.ok) return result.error;
    this.current = result.blueprint;
    this.dabs++;
    return null;
  }
  finish(cancelled: boolean): Blueprint | null {
    if (this.finished) return null;
    this.finished = true;
    return cancelled || !this.dabs ? null : this.current;
  }
}

/** Keep radius tied to model units as zoom or projection changes. */
export function brushRadiusPixels(radiusMm: number, height: number, projection: { kind: "perspective"; depth: number; fov: number } | { kind: "orthographic"; span: number }): number {
  if (!Number.isFinite(radiusMm) || radiusMm <= 0 || !Number.isFinite(height) || height <= 0) return 0;
  const span = projection.kind === "orthographic" ? projection.span : 2 * Math.max(projection.depth, .001) * Math.tan(projection.fov * Math.PI / 360);
  return Math.min(2000, radiusMm / 1000 * height / Math.max(span, .001));
}
