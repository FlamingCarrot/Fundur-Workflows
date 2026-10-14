import type { MeshData, Part, Size3, Vec3mm } from "./types";

/**
 * 3D Modeling engine primitive generators.
 * Generates clean, well-formed polygon meshes normalized in the unit cube [0, 1]^3.
 * Each primitive can be placed and sized anywhere in a Blueprint as a first-class mesh part.
 */

const r6 = (n: number) => Math.round(n * 1e6) / 1e6;
const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

/**
 * Torus / Ring / Donut
 */
export function generateTorus(radialSegments = 16, tubularSegments = 24, tubeRatio = 0.25): MeshData {
  const R = 0.5 - tubeRatio / 2; // Major radius
  const r = tubeRatio / 2; // Minor (tube) radius
  const v: [number, number, number][] = [];
  const f: number[][] = [];

  for (let j = 0; j < tubularSegments; j++) {
    const u = (j / tubularSegments) * Math.PI * 2;
    const cu = Math.cos(u);
    const su = Math.sin(u);

    for (let i = 0; i < radialSegments; i++) {
      const vAng = (i / radialSegments) * Math.PI * 2;
      const cv = Math.cos(vAng);
      const sv = Math.sin(vAng);

      const x = (R + r * cv) * cu + 0.5;
      const y = (R + r * cv) * su + 0.5;
      const z = r * sv + 0.5;

      v.push([r6(clamp01(x)), r6(clamp01(y)), r6(clamp01(z))]);
    }
  }

  for (let j = 0; j < tubularSegments; j++) {
    const nextJ = (j + 1) % tubularSegments;
    for (let i = 0; i < radialSegments; i++) {
      const nextI = (i + 1) % radialSegments;
      const a = j * radialSegments + i;
      const b = nextJ * radialSegments + i;
      const c = nextJ * radialSegments + nextI;
      const d = j * radialSegments + nextI;
      f.push([a, b, c, d]);
    }
  }

  return { v, f };
}

/**
 * Pyramid with N sides (default 4 = square pyramid, 3 = tetrahedron, 6 = hexagonal pyramid)
 */
export function generatePyramid(sides = 4): MeshData {
  const v: [number, number, number][] = [];
  const f: number[][] = [];
  const n = Math.max(3, sides);

  // Base vertices
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + Math.PI / n;
    const x = 0.5 + Math.cos(a) * 0.5;
    const y = 0.5 + Math.sin(a) * 0.5;
    v.push([r6(clamp01(x)), r6(clamp01(y)), 0]);
  }

  // Apex vertex
  const apex = v.length;
  v.push([0.5, 0.5, 1]);

  // Base face (facing down, clockwise winding seen from above)
  f.push(Array.from({ length: n }, (_, i) => n - 1 - i));

  // Side faces
  for (let i = 0; i < n; i++) {
    const next = (i + 1) % n;
    f.push([i, next, apex]);
  }

  return { v, f };
}

/**
 * Capsule / Pill: Cylinder with hemispherical top and bottom caps
 */
export function generateCapsule(lat = 6, lon = 16): MeshData {
  const v: [number, number, number][] = [];
  const f: number[][] = [];

  // Bottom pole
  v.push([0.5, 0.5, 0]);
  const bottomPole = 0;

  // Bottom hemisphere (z: 0 to 0.3)
  const ringStarts: number[] = [];
  for (let i = 1; i <= lat; i++) {
    const theta = (i / lat) * (Math.PI / 2);
    const sinT = Math.sin(theta);
    const cosT = Math.cos(theta);
    ringStarts.push(v.length);
    for (let j = 0; j < lon; j++) {
      const phi = (j / lon) * Math.PI * 2;
      const x = 0.5 + Math.cos(phi) * sinT * 0.5;
      const y = 0.5 + Math.sin(phi) * sinT * 0.5;
      const z = (1 - cosT) * 0.3;
      v.push([r6(clamp01(x)), r6(clamp01(y)), r6(clamp01(z))]);
    }
  }

  // Top hemisphere (z: 0.7 to 1)
  const topHemStarts: number[] = [];
  for (let i = 0; i < lat; i++) {
    const theta = (i / lat) * (Math.PI / 2);
    const sinT = Math.cos(theta);
    const cosT = Math.sin(theta);
    topHemStarts.push(v.length);
    for (let j = 0; j < lon; j++) {
      const phi = (j / lon) * Math.PI * 2;
      const x = 0.5 + Math.cos(phi) * sinT * 0.5;
      const y = 0.5 + Math.sin(phi) * sinT * 0.5;
      const z = 0.7 + cosT * 0.3;
      v.push([r6(clamp01(x)), r6(clamp01(y)), r6(clamp01(z))]);
    }
  }

  // Top pole
  const topPole = v.length;
  v.push([0.5, 0.5, 1]);

  // Faces for bottom hemisphere
  for (let j = 0; j < lon; j++) {
    const nextJ = (j + 1) % lon;
    f.push([bottomPole, ringStarts[0] + j, ringStarts[0] + nextJ]);
  }
  for (let i = 0; i < ringStarts.length - 1; i++) {
    const r1 = ringStarts[i];
    const r2 = ringStarts[i + 1];
    for (let j = 0; j < lon; j++) {
      const nextJ = (j + 1) % lon;
      f.push([r1 + j, r2 + j, r2 + nextJ, r1 + nextJ]);
    }
  }

  // Cylinder sides connecting bottom hemisphere to top hemisphere
  const lastBottomRing = ringStarts[ringStarts.length - 1];
  const firstTopRing = topHemStarts[0];
  for (let j = 0; j < lon; j++) {
    const nextJ = (j + 1) % lon;
    f.push([lastBottomRing + j, firstTopRing + j, firstTopRing + nextJ, lastBottomRing + nextJ]);
  }

  // Faces for top hemisphere
  for (let i = 0; i < topHemStarts.length - 1; i++) {
    const r1 = topHemStarts[i];
    const r2 = topHemStarts[i + 1];
    for (let j = 0; j < lon; j++) {
      const nextJ = (j + 1) % lon;
      f.push([r1 + j, r2 + j, r2 + nextJ, r1 + nextJ]);
    }
  }
  const lastTopRing = topHemStarts[topHemStarts.length - 1];
  for (let j = 0; j < lon; j++) {
    const nextJ = (j + 1) % lon;
    f.push([lastTopRing + j, topPole, lastTopRing + nextJ]);
  }

  return { v, f };
}

/**
 * Pipe / Tube: Hollow cylinder with wall thickness and solid rims
 */
export function generatePipe(wallRatio = 0.15, segments = 24): MeshData {
  const v: [number, number, number][] = [];
  const f: number[][] = [];
  const n = Math.max(8, segments);
  const wall = Math.min(Math.max(0.05, wallRatio), 0.45);
  const innerR = 0.5 - wall;

  // Bottom outer ring (0 .. n-1)
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    v.push([r6(clamp01(0.5 + Math.cos(a) * 0.5)), r6(clamp01(0.5 + Math.sin(a) * 0.5)), 0]);
  }
  // Bottom inner ring (n .. 2n-1)
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    v.push([r6(clamp01(0.5 + Math.cos(a) * innerR)), r6(clamp01(0.5 + Math.sin(a) * innerR)), 0]);
  }
  // Top outer ring (2n .. 3n-1)
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    v.push([r6(clamp01(0.5 + Math.cos(a) * 0.5)), r6(clamp01(0.5 + Math.sin(a) * 0.5)), 1]);
  }
  // Top inner ring (3n .. 4n-1)
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    v.push([r6(clamp01(0.5 + Math.cos(a) * innerR)), r6(clamp01(0.5 + Math.sin(a) * innerR)), 1]);
  }

  for (let i = 0; i < n; i++) {
    const next = (i + 1) % n;
    // Outer side wall
    f.push([i, next, 2 * n + next, 2 * n + i]);
    // Inner side wall (faces inwards)
    f.push([n + next, n + i, 3 * n + i, 3 * n + next]);
    // Bottom annular rim
    f.push([n + i, n + next, next, i]);
    // Top annular rim
    f.push([2 * n + i, 2 * n + next, 3 * n + next, 3 * n + i]);
  }

  return { v, f };
}

/**
 * Prism with N sides (e.g. 6 = Hexagonal column, 8 = Octagonal column, 3 = Triangular prism)
 */
export function generatePrism(sides = 6): MeshData {
  const v: [number, number, number][] = [];
  const f: number[][] = [];
  const n = Math.max(3, sides);

  // Bottom vertices
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    v.push([r6(clamp01(0.5 + Math.cos(a) * 0.5)), r6(clamp01(0.5 + Math.sin(a) * 0.5)), 0]);
  }
  // Top vertices
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    v.push([r6(clamp01(0.5 + Math.cos(a) * 0.5)), r6(clamp01(0.5 + Math.sin(a) * 0.5)), 1]);
  }

  // Bottom face
  f.push(Array.from({ length: n }, (_, i) => n - 1 - i));
  // Top face
  f.push(Array.from({ length: n }, (_, i) => n + i));

  // Side quads
  for (let i = 0; i < n; i++) {
    const next = (i + 1) % n;
    f.push([i, next, n + next, n + i]);
  }

  return { v, f };
}

/**
 * Hemispherical Dome with flat base
 */
export function generateDome(lat = 8, lon = 16): MeshData {
  const v: [number, number, number][] = [];
  const f: number[][] = [];

  // Base center point
  v.push([0.5, 0.5, 0]);
  const baseCenter = 0;

  // Base rim / lowest latitude ring
  const ringStarts: number[] = [];
  for (let i = 0; i < lat; i++) {
    const theta = (i / lat) * (Math.PI / 2);
    const cosT = Math.cos(theta);
    const sinT = Math.sin(theta);
    ringStarts.push(v.length);
    for (let j = 0; j < lon; j++) {
      const phi = (j / lon) * Math.PI * 2;
      const x = 0.5 + Math.cos(phi) * cosT * 0.5;
      const y = 0.5 + Math.sin(phi) * cosT * 0.5;
      const z = sinT;
      v.push([r6(clamp01(x)), r6(clamp01(y)), r6(clamp01(z))]);
    }
  }

  // Apex (top point)
  const apex = v.length;
  v.push([0.5, 0.5, 1]);

  // Base disc faces
  const baseRim = ringStarts[0];
  for (let j = 0; j < lon; j++) {
    const next = (j + 1) % lon;
    f.push([baseCenter, baseRim + next, baseRim + j]);
  }

  // Dome rings
  for (let i = 0; i < ringStarts.length - 1; i++) {
    const r1 = ringStarts[i];
    const r2 = ringStarts[i + 1];
    for (let j = 0; j < lon; j++) {
      const next = (j + 1) % lon;
      f.push([r1 + j, r1 + next, r2 + next, r2 + j]);
    }
  }

  // Apex triangle fan
  const topRing = ringStarts[ringStarts.length - 1];
  for (let j = 0; j < lon; j++) {
    const next = (j + 1) % lon;
    f.push([topRing + j, topRing + next, apex]);
  }

  return { v, f };
}

/**
 * Architectural Steps / Staircase
 */
export function generateStairs(stepCount = 5): MeshData {
  const steps = Math.max(2, Math.min(24, stepCount));
  const v: [number, number, number][] = [];
  const f: number[][] = [];

  // Create stepped profile along Y and Z, spanning X from 0 to 1
  // For each step i:
  // riser from (y_i, z_i) to (y_i, z_{i+1})
  // tread from (y_i, z_{i+1}) to (y_{i+1}, z_{i+1})
  const profile: [number, number][] = [];
  for (let i = 0; i < steps; i++) {
    const y0 = i / steps;
    const y1 = (i + 1) / steps;
    const z0 = i / steps;
    const z1 = (i + 1) / steps;
    profile.push([y0, z0], [y0, z1], [y1, z1]);
  }
  // Bottom-back corner and origin
  profile.push([1, 0], [0, 0]);

  // Left vertices (x = 0)
  const leftStart = 0;
  for (const [y, z] of profile) v.push([0, r6(y), r6(z)]);

  // Right vertices (x = 1)
  const rightStart = v.length;
  for (const [y, z] of profile) v.push([1, r6(y), r6(z)]);

  // Left side wall face
  const P = profile.length;
  f.push(Array.from({ length: P }, (_, i) => leftStart + i));
  // Right side wall face (reversed)
  f.push(Array.from({ length: P }, (_, i) => rightStart + P - 1 - i));

  // Treads, risers, back, and bottom connecting left and right
  for (let i = 0; i < P; i++) {
    const next = (i + 1) % P;
    f.push([leftStart + next, leftStart + i, rightStart + i, rightStart + next]);
  }

  return { v, f };
}

/**
 * Curved Arch / Portal
 */
export function generateArch(wallThicknessRatio = 0.25, segments = 12): MeshData {
  const v: [number, number, number][] = [];
  const f: number[][] = [];
  const n = Math.max(6, segments);
  const wall = Math.min(Math.max(0.1, wallThicknessRatio), 0.4);

  // Front profile (y = 0)
  // Outer rectangle: (0,0), (1,0), (1,1), (0,1)
  // Inner arch cutout from x = wall to 1 - wall
  const frontOutline: [number, number][] = [
    [0, 0],
    [wall, 0],
    [wall, 0.5],
  ];
  const innerR = 0.5 - wall;
  for (let i = 0; i <= n; i++) {
    const a = Math.PI - (i / n) * Math.PI;
    const x = 0.5 + Math.cos(a) * innerR;
    const z = 0.5 + Math.sin(a) * innerR;
    frontOutline.push([x, z]);
  }
  frontOutline.push([1 - wall, 0], [1, 0], [1, 1], [0, 1]);

  // Front vertices (y = 0)
  const frontStart = 0;
  for (const [x, z] of frontOutline) v.push([r6(clamp01(x)), 0, r6(clamp01(z))]);

  // Back vertices (y = 1)
  const backStart = v.length;
  for (const [x, z] of frontOutline) v.push([r6(clamp01(x)), 1, r6(clamp01(z))]);

  const P = frontOutline.length;
  f.push(Array.from({ length: P }, (_, i) => frontStart + i));
  f.push(Array.from({ length: P }, (_, i) => backStart + P - 1 - i));

  for (let i = 0; i < P; i++) {
    const next = (i + 1) % P;
    f.push([frontStart + i, frontStart + next, backStart + next, backStart + i]);
  }

  return { v, f };
}

export interface DetailedPrimitiveChoice {
  key: string;
  label: string;
  category: "basic" | "architectural" | "structural";
  defaultSize: Size3;
  generate: () => MeshData;
}

export const DETAILED_PRIMITIVES: DetailedPrimitiveChoice[] = [
  { key: "torus", label: "Torus / Ring", category: "basic", defaultSize: { w: 300, d: 300, h: 80 }, generate: () => generateTorus() },
  { key: "pyramid", label: "Pyramid", category: "basic", defaultSize: { w: 400, d: 400, h: 400 }, generate: () => generatePyramid(4) },
  { key: "capsule", label: "Capsule / Pill", category: "basic", defaultSize: { w: 200, d: 200, h: 600 }, generate: () => generateCapsule() },
  { key: "pipe", label: "Pipe / Tube", category: "structural", defaultSize: { w: 200, d: 200, h: 600 }, generate: () => generatePipe() },
  { key: "prism", label: "Hex Column", category: "structural", defaultSize: { w: 300, d: 300, h: 800 }, generate: () => generatePrism(6) },
  { key: "dome", label: "Dome", category: "architectural", defaultSize: { w: 400, d: 400, h: 250 }, generate: () => generateDome() },
  { key: "stairs", label: "Stairs / Steps", category: "architectural", defaultSize: { w: 800, d: 1000, h: 600 }, generate: () => generateStairs(5) },
  { key: "arch", label: "Curved Arch", category: "architectural", defaultSize: { w: 900, d: 200, h: 1200 }, generate: () => generateArch() },
];

export function createPrimitivePart(key: string, at: Vec3mm, customSize?: Size3): Part | null {
  const item = DETAILED_PRIMITIVES.find((p) => p.key === key);
  if (!item) return null;
  const size = customSize ?? item.defaultSize;
  const mesh = item.generate();
  const id = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10);
  return {
    id,
    name: item.label,
    shape: "mesh",
    at,
    size,
    rotation: 0,
    material: "std:warm-grey-paint",
    mesh,
  };
}
