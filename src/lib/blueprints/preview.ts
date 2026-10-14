import { CLAY } from "./materials";
import { extrudedOutline, flatten, footprint, spread, type Primitive, type Resolver } from "./resolve";
import type { Blueprint } from "./types";
import { faceNormal } from "./mesh";

/**
 * A small isometric picture of a blueprint, drawn as flat polygons (no 3D
 * needed), for browsing the library: from the front-right and above, shaded
 * by which way each face points. Works the same on a phone and in tests.
 */

export interface PreviewFace {
  points: string;
  fill: string;
}
export interface Preview {
  viewBox: string;
  faces: PreviewFace[];
}

const R2 = Math.SQRT2;
const R6 = Math.sqrt(6);
const project = (x: number, y: number, z: number): [number, number] => [(x + y) / R2, -(-x + y + 2 * z) / R6];
/** Larger is nearer the eye, which looks from the front right, above. */
const nearness = (x: number, y: number, z: number) => x - y + z;

function shade(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v: number) => Math.max(0, Math.min(255, Math.round(v * k)));
  return `rgb(${ch((n >> 16) & 255)},${ch((n >> 8) & 255)},${ch(n & 255)})`;
}

function ring(p: Primitive): { x: number; y: number }[] {
  if (p.shape === "box" || p.shape === "wedge") return footprint(p);
  if (p.shape === "extrude" && (p.profile?.length ?? 0) >= 3) {
    const pts = extrudedOutline({ ...p, taper: 1 });
    // Anticlockwise, as the sides' facing test expects.
    const area = pts.reduce((sum, a, i) => sum + a.x * pts[(i + 1) % pts.length].y - pts[(i + 1) % pts.length].x * a.y, 0);
    return area < 0 ? pts.reverse() : pts;
  }
  // A lathe is drawn as a drum as wide as it gets.
  if (p.shape === "lathe") return ring({ ...p, shape: "cylinder", w: p.w * spread(p), d: p.d * spread(p) });
  const n = 16;
  const c = Math.cos(p.rotation);
  const s = Math.sin(p.rotation);
  return Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    const x = (Math.cos(a) * p.w) / 2;
    const y = (Math.sin(a) * p.d) / 2;
    return { x: p.x + x * c - y * s, y: p.y + x * s + y * c };
  });
}

export function previewFaces(shapes: Primitive[], colorOf: (material?: string) => string): Preview {
  type Face = { pts: [number, number][]; fill: string; depth: number; order: number };
  const faces: Face[] = [];
  shapes.forEach((p, order) => {
    const base = colorOf(p.material);
    if (p.shape === "mesh" && p.mesh) {
      // A mesh draws its own faces: those turned towards the eye, lit by which way they face.
      const c = Math.cos(p.rotation);
      const s = Math.sin(p.rotation);
      const world = p.mesh.v.map(([u, v, t]) => {
        const x = (u - 0.5) * p.w;
        const y = (v - 0.5) * p.d;
        return [p.x + x * c - y * s, p.y + x * s + y * c, p.z + t * p.h] as [number, number, number];
      });
      for (const f of p.mesh.f) {
        const poly = f.map((i) => world[i]).filter(Boolean);
        if (poly.length < 3) continue;
        const [nx, ny, nz] = faceNormal(poly);
        if (nx - ny + nz <= 0) continue;
        const mid = poly.reduce((m, q) => [m[0] + q[0] / poly.length, m[1] + q[1] / poly.length, m[2] + q[2] / poly.length], [0, 0, 0]);
        faces.push({ pts: poly.map(([x, y, z]) => project(x, y, z)), fill: shade(base, 0.62 + 0.25 * Math.max(0, nx) + 0.08 * Math.max(0, -ny) + 0.4 * Math.max(0, nz)), depth: nearness(mid[0], mid[1], mid[2]), order });
      }
      return;
    }
    const ringPts = ring(p);
    // A taper narrows the top about the middle.
    const k = p.shape === "lathe" ? 1 : (p.taper ?? 1);
    const topPts = ringPts.map((q) => ({ x: p.x + (q.x - p.x) * k, y: p.y + (q.y - p.y) * k }));
    const bottom = p.z;
    // A sphere is drawn as a squat drum; a wedge's top slopes from the front up to the back.
    const top = p.shape === "sphere" ? p.z + p.h * 0.85 : p.z + p.h;
    const lift = p.shape === "sphere" ? p.z + p.h * 0.15 : bottom;
    const n = ringPts.length;
    const topZ = (q: { x: number; y: number }) => {
      if (p.shape !== "wedge") return top;
      const back = { x: -Math.sin(p.rotation), y: Math.cos(p.rotation) };
      const t = ((q.x - p.x) * back.x + (q.y - p.y) * back.y) / (p.d || 1) + 0.5;
      return bottom + p.h * Math.max(0, Math.min(1, t));
    };
    for (let i = 0; i < n; i++) {
      const a = ringPts[i];
      const b = ringPts[(i + 1) % n];
      // Outward normal of the side, for counter-clockwise rings.
      const nx = b.y - a.y;
      const ny = -(b.x - a.x);
      const facing = nx - ny;
      if (facing <= 0) continue;
      const len = Math.hypot(nx, ny) || 1;
      const light = 0.62 + 0.25 * (nx / len > 0 ? nx / len : 0) + 0.08 * (-ny / len > 0 ? -ny / len : 0);
      const ta = topPts[i];
      const tb = topPts[(i + 1) % n];
      const pts: [number, number][] = [project(a.x, a.y, lift), project(b.x, b.y, lift), project(tb.x, tb.y, topZ(b)), project(ta.x, ta.y, topZ(a))];
      faces.push({ pts, fill: shade(base, light), depth: nearness((a.x + b.x) / 2, (a.y + b.y) / 2, (lift + top) / 2), order });
    }
    faces.push({ pts: topPts.map((q, i) => project(q.x, q.y, topZ(ringPts[i]))), fill: shade(base, 1.04), depth: nearness(p.x, p.y, top) + 1e-6, order });
  });
  // Far to near; a part's top after its sides.
  faces.sort((a, b) => a.depth - b.depth || a.order - b.order);
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;
  for (const f of faces)
    for (const [x, y] of f.pts) {
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
  if (!faces.length) return { viewBox: "-1 -1 2 2", faces: [] };
  const pad = Math.max(maxX - minX, maxY - minY) * 0.06;
  return {
    viewBox: `${(minX - pad).toFixed(1)} ${(minY - pad).toFixed(1)} ${(maxX - minX + pad * 2).toFixed(1)} ${(maxY - minY + pad * 2).toFixed(1)}`,
    faces: faces.map((f) => ({ points: f.pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" "), fill: f.fill })),
  };
}

const cache = new Map<string, Preview>();

export function blueprintPreview(lib: Resolver, bp: Blueprint, clay = false): Preview {
  const key = `${bp.id}@${bp.revision}:${bp.updatedAt ?? ""}:${clay}:${lib.blueprints.length}:${lib.materials.length}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const preview = previewFaces(flatten(lib, bp), (m) => (clay ? CLAY : (m && lib.material(m)?.color) || CLAY));
  if (cache.size > 1_500) cache.clear();
  cache.set(key, preview);
  return preview;
}
