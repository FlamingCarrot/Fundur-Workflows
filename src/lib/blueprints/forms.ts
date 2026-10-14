import type { ProfilePoint } from "./types";

/**
 * The shapes beyond boxes and balls: profiles turned on a lathe (vases, pots,
 * lamp bases, bowls, balusters) and outlines extruded upwards (an L-shaped
 * desk top, a hexagonal side table, an arch). Points are shares of the part's
 * size, so a part keeps its form when it is stretched. Hollowing turns a solid
 * into a vessel: the same outside, a wall and a base of a set thickness, open
 * at the top. Safe in the browser and on the server.
 */

const round = (n: number) => Math.round(Math.max(0, Math.min(1, n)) * 1_000) / 1_000;

export interface FormPreset {
  key: string;
  label: string;
  profile: ProfilePoint[];
}

/** Lathe profiles: (radius share, height share), bottom up. */
export const LATHE_PRESETS: FormPreset[] = [
  { key: "planter", label: "Planter", profile: [[0, 0], [0.78, 0], [0.8, 0.06], [1, 0.92], [1, 1], [0, 1]] },
  { key: "vase", label: "Vase", profile: [[0, 0], [0.62, 0], [0.92, 0.28], [0.9, 0.55], [0.5, 0.82], [0.46, 0.92], [0.6, 1], [0, 1]] },
  { key: "bowl", label: "Bowl", profile: [[0, 0], [0.45, 0], [0.82, 0.32], [0.98, 0.72], [1, 1], [0, 1]] },
  { key: "bottle", label: "Bottle", profile: [[0, 0], [0.98, 0], [1, 0.55], [0.88, 0.66], [0.32, 0.78], [0.3, 1], [0, 1]] },
  { key: "baluster", label: "Baluster", profile: [[0, 0], [1, 0], [1, 0.08], [0.55, 0.12], [0.75, 0.38], [0.4, 0.62], [0.42, 0.88], [0.9, 0.92], [0.9, 1], [0, 1]] },
  { key: "column", label: "Classical Column", profile: [[0, 0], [1, 0], [1, 0.08], [0.82, 0.12], [0.78, 0.88], [0.95, 0.94], [1, 0.96], [1, 1], [0, 1]] },
  { key: "dome", label: "Dome", profile: [[0, 0], [1, 0], [0.97, 0.25], [0.87, 0.5], [0.7, 0.72], [0.44, 0.9], [0, 1]] },
  { key: "shade", label: "Lamp shade", profile: [[0, 0], [1, 0], [0.58, 1], [0, 1]] },
  { key: "pedestal", label: "Pedestal", profile: [[0, 0], [1, 0], [1, 0.06], [0.35, 0.12], [0.3, 0.88], [0.9, 0.94], [0.9, 1], [0, 1]] },
  { key: "knob", label: "Round Knob", profile: [[0, 0], [0.35, 0], [0.3, 0.3], [0.75, 0.5], [1, 0.75], [0.75, 0.95], [0, 1]] },
  { key: "finial", label: "Finial", profile: [[0, 0], [0.8, 0], [0.8, 0.1], [0.4, 0.2], [0.9, 0.5], [0.9, 0.7], [0.4, 0.85], [0.5, 0.92], [0, 1]] },
];

/** Extrusion outlines seen from above: (share across, share back). */
export const OUTLINE_PRESETS: FormPreset[] = [
  { key: "l", label: "L shape", profile: [[0, 0], [1, 0], [1, 0.45], [0.4, 0.45], [0.4, 1], [0, 1]] },
  { key: "u", label: "U shape", profile: [[0, 0], [1, 0], [1, 1], [0.7, 1], [0.7, 0.35], [0.3, 0.35], [0.3, 1], [0, 1]] },
  { key: "t", label: "T shape", profile: [[0, 0.6], [0.35, 0.6], [0.35, 0], [0.65, 0], [0.65, 0.6], [1, 0.6], [1, 1], [0, 1]] },
  { key: "triangle", label: "Triangle", profile: [[0, 0], [1, 0], [0.5, 1]] },
  { key: "hexagon", label: "Hexagon", profile: polygon(6, Math.PI / 6) },
  { key: "octagon", label: "Octagon", profile: polygon(8, Math.PI / 8) },
  { key: "arch", label: "Arch", profile: arch() },
  { key: "chamfered", label: "Cut corners", profile: [[0.12, 0], [0.88, 0], [1, 0.12], [1, 0.88], [0.88, 1], [0.12, 1], [0, 0.88], [0, 0.12]] },
  { key: "cornice", label: "Crown Cornice", profile: [[0, 0], [1, 0], [1, 0.2], [0.7, 0.4], [0.7, 0.6], [0.4, 0.8], [0.3, 1], [0, 1]] },
  { key: "baseboard", label: "Baseboard", profile: [[0, 0], [1, 0], [1, 0.65], [0.6, 0.85], [0.4, 0.95], [0.1, 1], [0, 1]] },
  { key: "ogee", label: "Ogee S-Curve", profile: [[0, 0], [1, 0], [0.9, 0.25], [0.65, 0.5], [0.35, 0.75], [0.1, 1], [0, 1]] },
  { key: "bullnose", label: "Bullnose", profile: [[0, 0], [0.8, 0], [1, 0.2], [1, 0.8], [0.8, 1], [0, 1]] },
  { key: "ibeam", label: "I-Beam", profile: [[0, 0], [1, 0], [1, 0.2], [0.62, 0.2], [0.62, 0.8], [1, 0.8], [1, 1], [0, 1], [0, 0.8], [0.38, 0.8], [0.38, 0.2], [0, 0.2]] },
  { key: "fluted", label: "Fluted Panel", profile: flutedOutline(4) },
];

function polygon(n: number, start = 0): ProfilePoint[] {
  return Array.from({ length: n }, (_, i) => {
    const a = start + (i / n) * Math.PI * 2;
    return [round(0.5 + Math.cos(a) / 2), round(0.5 + Math.sin(a) / 2)] as ProfilePoint;
  });
}

function arch(): ProfilePoint[] {
  const top = Array.from({ length: 13 }, (_, i) => {
    const a = (i / 12) * Math.PI;
    return [round(0.5 + Math.cos(a) / 2), round(0.5 + Math.sin(a) / 2)] as ProfilePoint;
  });
  return [[0, 0], [1, 0], ...top];
}

function flutedOutline(flutes = 4): ProfilePoint[] {
  const pts: ProfilePoint[] = [[0, 0], [1, 0]];
  for (let i = flutes; i >= 0; i--) {
    const x = i / flutes;
    const y = i % 2 === 0 ? 1 : 0.82;
    pts.push([round(x), round(y)]);
  }
  return pts;
}


/** The profile a new lathe or extrusion starts with. */
export const defaultProfile = (shape: "lathe" | "extrude"): ProfilePoint[] => (shape === "lathe" ? LATHE_PRESETS[0] : OUTLINE_PRESETS[0]).profile.map(([a, b]) => [a, b]);

/** Points kept inside 0 to 1, rounded, with repeats in a row dropped. */
export function cleanProfile(points: ProfilePoint[]): ProfilePoint[] {
  const out: ProfilePoint[] = [];
  for (const [a, b] of points) {
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    const p: ProfilePoint = [round(a), round(b)];
    const last = out[out.length - 1];
    if (!last || Math.abs(last[0] - p[0]) > 1e-4 || Math.abs(last[1] - p[1]) > 1e-4) out.push(p);
  }
  if (out.length > 1 && Math.abs(out[0][0] - out[out.length - 1][0]) < 1e-4 && Math.abs(out[0][1] - out[out.length - 1][1]) < 1e-4) out.pop();
  return out;
}

/** The widest a lathe gets, as a share of its width. */
export const latheReach = (profile: ProfilePoint[]) => Math.max(0.01, ...profile.map(([r]) => r));

/**
 * The silhouette a lathe turns (radius share, height share), bottom up and
 * closed on the axis. Hollow: its wall and base `wall` and `base` thick (as
 * shares of the half-width and height), open at the top. A plain cylinder is
 * the profile from the middle of its base out, up its side (tapered) and in
 * across its top.
 */
export function latheOutline(profile: ProfilePoint[] | undefined, opts: { taper?: number; wall?: number; base?: number } = {}): ProfilePoint[] {
  const taper = opts.taper ?? 1;
  let outer = profile && profile.length >= 2 ? cleanProfile(profile) : ([[0, 0], [1, 0], [taper, 1], [0, 1]] as ProfilePoint[]);
  // Trim the points on the axis: the outside runs from the bottom edge to the top edge.
  while (outer.length > 2 && outer[0][0] < 1e-3) outer = outer.slice(1);
  while (outer.length > 2 && outer[outer.length - 1][0] < 1e-3) outer = outer.slice(0, -1);
  const bottomZ = outer[0][1];
  const topZ = outer[outer.length - 1][1];
  if (!opts.wall || opts.wall <= 0) return [[0, bottomZ], ...outer, [0, topZ]];
  const wall = Math.min(opts.wall, 0.95);
  const base = Math.min(Math.max(opts.base ?? wall, 0.005), 0.9);
  const floor = bottomZ + base;
  // The inside follows the outside in by the wall, from the rim down to the base.
  const inner: ProfilePoint[] = [];
  for (let i = outer.length - 1; i >= 0; i--) {
    const [r, z] = outer[i];
    if (z <= floor) break;
    inner.push([Math.max(0.002, r - wall), z]);
  }
  if (!inner.length) return [[0, bottomZ], ...outer, [0, topZ]];
  const atFloor = Math.max(0.002, radiusAt(outer, floor) - wall);
  return [[0, bottomZ], ...outer, ...inner, [atFloor, floor], [0, floor]];
}

/** The outside's radius at a height, read along the profile. */
function radiusAt(outer: ProfilePoint[], z: number): number {
  for (let i = 0; i < outer.length - 1; i++) {
    const [r0, z0] = outer[i];
    const [r1, z1] = outer[i + 1];
    if ((z - z0) * (z - z1) <= 0 && z1 !== z0) return r0 + ((z - z0) / (z1 - z0)) * (r1 - r0);
  }
  return outer[0][0];
}
