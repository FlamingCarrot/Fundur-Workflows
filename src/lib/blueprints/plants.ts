import type { Part, ProfilePoint, Vec3mm } from "./types";

/**
 * Grows a plant out of parts: a trunk and branches as tapered, leaning
 * cylinders, and leaves as thin leaf-shaped extrusions on short stalks, each
 * turned and tipped its own way. The same seed grows the same plant, so a
 * smaller copy keeps its character. Millimetres in the blueprint's frame.
 */

export const LEAF_SHAPES = ["ovate", "lance", "round", "heart", "fiddle", "blade"] as const;
export type LeafShape = (typeof LEAF_SHAPES)[number];
export const PLANT_STYLES = ["tree", "bush", "rosette", "trailing"] as const;
export type PlantStyle = (typeof PLANT_STYLES)[number];

export interface PlantSpec {
  /** Where it grows from: the soil's middle. */
  base: Vec3mm;
  /** From the base to the top of the leaves. */
  height: number;
  /** How wide the leaves reach. */
  spread: number;
  style: PlantStyle;
  leaf: LeafShape;
  leaves: number;
  leafLength: number;
  leafWidth?: number;
  /** Main stems (bush), branches (tree) or crowns (rosette). */
  branches?: number;
  trunkMaterial?: string;
  leafMaterials?: string[];
  seed?: number;
}

export type GrownPart = Omit<Part, "id">;

/** Half-width of a leaf at t (0 base, 1 tip), as a share of its full width. */
const WIDTH: Record<LeafShape, (t: number) => number> = {
  ovate: (t) => Math.sin(Math.PI * Math.pow(t, 0.8)) * 0.5,
  lance: (t) => Math.sin(Math.PI * Math.pow(t, 0.6)) * 0.5 * (1 - 0.3 * t),
  round: (t) => Math.sqrt(Math.max(0, t * (1 - t))),
  heart: (t) => (t < 0.18 ? 0.25 + t * 1.4 : Math.sin(Math.PI * (0.18 + (t - 0.18) * 0.82)) * 0.5) * (t < 0.03 ? 0.6 : 1),
  fiddle: (t) => (0.5 * Math.sin(Math.PI * Math.pow(t, 0.55))) * (1 - 0.18 * Math.exp(-((t - 0.45) ** 2) / 0.01)),
  blade: (t) => 0.5 * (t < 0.08 ? 0.6 + t * 5 : 1) * (t > 0.85 ? (1 - t) / 0.15 : 1),
};

/** A leaf's outline seen from above: across 0..1, base (0) to tip (1) along the back. */
export function leafOutline(shape: LeafShape, steps = 12): ProfilePoint[] {
  const half = WIDTH[shape];
  const right: ProfilePoint[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    right.push([0.5 + Math.min(0.5, Math.max(0.01, half(t))), t]);
  }
  right[right.length - 1] = [0.5, 1];
  const left: ProfilePoint[] = right.slice(1, -1).reverse().map(([x, y]) => [1 - x, y]);
  const r4 = (v: number) => Math.round(v * 10_000) / 10_000;
  return [[0.5, 0], ...right.slice(1), ...left].map(([x, y]) => [r4(x), r4(y)] as ProfilePoint);
}

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1_664_525 + 1_013_904_223) >>> 0;
    return s / 4_294_967_296;
  };
}

const r1 = (v: number) => Math.round(v * 10) / 10;
/** Degrees in -180..180, so many leaves turned round and round stay a valid rotation. */
const turn = (rad: number) => {
  const d = (((rad * 180) / Math.PI) % 360 + 540) % 360 - 180;
  return r1(d);
};
const clampTilt = (v: number) => Math.max(-89, Math.min(89, v));

/** A stalk from p, heading at an azimuth (radians, from +y towards -x as rotation turns) and an angle from upright (degrees). */
function stalk(p: Vec3mm, length: number, azimuth: number, fromUp: number, thick: number, taper: number, material: string | undefined, name: string): { part: GrownPart; tip: Vec3mm } {
  const e = (clampTilt(fromUp) * Math.PI) / 180;
  const dir = { x: -Math.sin(azimuth), y: Math.cos(azimuth) };
  const half = length / 2;
  const part: GrownPart = {
    name,
    shape: "cylinder",
    at: { x: r1(p.x + dir.x * half * Math.sin(e)), y: r1(p.y + dir.y * half * Math.sin(e)), z: r1(p.z - half + half * Math.cos(e)) },
    size: { w: r1(thick), d: r1(thick), h: r1(length) },
    rotation: turn(azimuth),
    taper,
    ...(fromUp ? { tilt: { x: r1(clampTilt(fromUp)) } } : {}),
    ...(material ? { material } : {}),
  };
  return { part, tip: { x: p.x + dir.x * length * Math.sin(e), y: p.y + dir.y * length * Math.sin(e), z: p.z + length * Math.cos(e) } };
}

/** A leaf whose base sits at p, pointing out along the azimuth and lifted by an angle above level (negative droops). */
function leaf(p: Vec3mm, length: number, width: number, azimuth: number, lift: number, outline: ProfilePoint[], material: string | undefined): GrownPart {
  const e = (clampTilt(lift) * Math.PI) / 180;
  const dir = { x: -Math.sin(azimuth), y: Math.cos(azimuth) };
  const half = length / 2;
  const thick = Math.max(2, Math.min(6, width * 0.03));
  return {
    name: "Leaf",
    shape: "extrude",
    at: { x: r1(p.x + dir.x * half * Math.cos(e)), y: r1(p.y + dir.y * half * Math.cos(e)), z: r1(p.z + half * Math.sin(e) - thick / 2) },
    size: { w: r1(width), d: r1(length), h: r1(thick) },
    rotation: turn(azimuth),
    profile: outline,
    ...(lift ? { tilt: { x: r1(clampTilt(-lift)) } } : {}),
    ...(material ? { material } : {}),
  };
}

const DEFAULT_WIDTH: Record<LeafShape, number> = { ovate: 0.5, lance: 0.2, round: 0.85, heart: 0.75, fiddle: 0.7, blade: 0.14 };

export function growPlant(spec: PlantSpec): GrownPart[] {
  const rand = rng(spec.seed ?? 7);
  const between = (a: number, b: number) => a + (b - a) * rand();
  const out: GrownPart[] = [];
  const outline = leafOutline(spec.leaf);
  const mats = spec.leafMaterials?.length ? spec.leafMaterials : [undefined];
  const leafMat = () => mats[Math.floor(rand() * mats.length)];
  const L = spec.leafLength;
  const W = spec.leafWidth ?? L * DEFAULT_WIDTH[spec.leaf];
  const count = Math.max(1, Math.min(160, Math.round(spec.leaves)));
  const reach = spec.spread / 2;
  const golden = Math.PI * (3 - Math.sqrt(5));
  const addLeaf = (at: Vec3mm, az: number, lift: number, scale = 1, petiole = 0) => {
    let p = at;
    if (petiole > 0) {
      const s = stalk(at, petiole, az, 90 - Math.max(-60, Math.min(80, lift + 25)), Math.max(3, W * 0.05), 0.7, spec.trunkMaterial, "Leaf stalk");
      out.push(s.part);
      p = s.tip;
    }
    out.push(leaf(p, L * scale, W * scale, az, lift, outline, leafMat()));
  };

  if (spec.style === "rosette" || spec.style === "trailing") {
    // Leaves rise (or spill, trailing) from the base on stalks, the inner ones more upright and younger.
    const crowns = Math.max(1, Math.min(5, spec.branches ?? 1));
    for (let i = 0; i < count; i++) {
      const crown = i % crowns;
      const off = crowns > 1 ? { x: Math.cos((crown / crowns) * Math.PI * 2) * reach * 0.25, y: Math.sin((crown / crowns) * Math.PI * 2) * reach * 0.25 } : { x: 0, y: 0 };
      const k = i / count;
      const az = i * golden + between(-0.2, 0.2);
      const scale = between(0.75, 1.05) * (spec.style === "trailing" ? 1 : 1 - 0.3 * k);
      const upright = spec.leaf === "blade" || spec.leaf === "lance";
      const petiole = upright ? 0 : Math.max(0, spec.height - L * scale) * between(0.5, 1);
      const lift = spec.style === "trailing" ? between(-75, -35) : upright ? between(55, 85) : between(15, 55) + 30 * (1 - k);
      addLeaf({ x: spec.base.x + off.x, y: spec.base.y + off.y, z: spec.base.z }, az, lift, scale, spec.style === "trailing" ? between(20, 60) : petiole);
    }
    return out;
  }

  if (spec.style === "bush") {
    const stems = Math.max(2, Math.min(9, spec.branches ?? 5));
    const tips: { p: Vec3mm; az: number; len: number; from: Vec3mm }[] = [];
    for (let s = 0; s < stems; s++) {
      const az = s * golden * 2 + between(-0.3, 0.3);
      const lean = between(10, 35);
      const len = spec.height * between(0.75, 0.95) / Math.cos((lean * Math.PI) / 180);
      const st = stalk({ ...spec.base }, len, az, lean, Math.max(5, spec.height * 0.012), 0.5, spec.trunkMaterial, "Stem");
      out.push(st.part);
      tips.push({ p: st.tip, az, len, from: spec.base });
    }
    for (let i = 0; i < count; i++) {
      const t = tips[i % tips.length];
      const along = between(0.35, 1);
      const at = { x: t.from.x + (t.p.x - t.from.x) * along, y: t.from.y + (t.p.y - t.from.y) * along, z: t.from.z + (t.p.z - t.from.z) * along };
      addLeaf(at, t.az + between(-1.4, 1.4), between(-20, 45), between(0.7, 1), 0);
    }
    return out;
  }

  // A tree: a trunk to the crown, branches fanning up and out, leaves along their outer parts and tips.
  const trunkH = Math.max(spec.height * 0.25, spec.height - Math.max(L * 2, spec.height * 0.45));
  const trunkW = Math.max(8, spec.height * 0.018);
  const trunk = stalk({ ...spec.base }, trunkH, 0, between(0, 4), trunkW, 0.7, spec.trunkMaterial, "Trunk");
  out.push(trunk.part);
  const n = Math.max(2, Math.min(10, spec.branches ?? 5));
  const crownH = spec.height - trunkH;
  const ends: { from: Vec3mm; to: Vec3mm; az: number }[] = [];
  for (let b = 0; b < n; b++) {
    const az = b * golden * 2 + between(-0.25, 0.25);
    const startAt = between(0.55, 1);
    const from = { x: spec.base.x + (trunk.tip.x - spec.base.x) * startAt, y: spec.base.y + (trunk.tip.y - spec.base.y) * startAt, z: spec.base.z + trunkH * startAt };
    const lean = between(30, 60);
    const len = Math.min(Math.hypot(reach * between(0.6, 0.95), crownH * 0.6), (crownH * 0.85) / Math.cos((lean * Math.PI) / 180));
    const br = stalk(from, len, az, lean, trunkW * 0.55, 0.5, spec.trunkMaterial, "Branch");
    out.push(br.part);
    ends.push({ from, to: br.tip, az });
    // A twig off each branch, for a less regular crown.
    if (count > n * 6) {
      const mid = { x: (from.x + br.tip.x) / 2, y: (from.y + br.tip.y) / 2, z: (from.z + br.tip.z) / 2 };
      const twigAz = az + between(-1, 1);
      const tw = stalk(mid, len * 0.5, twigAz, between(25, 55), trunkW * 0.35, 0.5, spec.trunkMaterial, "Twig");
      out.push(tw.part);
      ends.push({ from: mid, to: tw.tip, az: twigAz });
    }
  }
  ends.push({ from: { ...trunk.tip, z: trunk.tip.z - trunkH * 0.1 }, to: { ...trunk.tip, z: trunk.tip.z + crownH * 0.35 }, az: 0 });
  for (let i = 0; i < count; i++) {
    const e = ends[i % ends.length];
    const along = between(0.4, 1);
    const at = { x: e.from.x + (e.to.x - e.from.x) * along, y: e.from.y + (e.to.y - e.from.y) * along, z: e.from.z + (e.to.z - e.from.z) * along };
    addLeaf(at, e.az + between(-1.6, 1.6), between(-35, 40), between(0.7, 1.05), L * 0.12);
  }
  return out;
}
