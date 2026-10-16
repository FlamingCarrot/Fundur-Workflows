import { latheOutline } from "./forms";
import type { MeshData, Part, Vec3mm } from "./types";

/**
 * Poly meshes: a part made of its own points (vertices) and flat faces
 * (polygons of three or more points), edited point by point as in Blender or
 * SketchUp. Points are kept as shares of the part's box (0 to 1 across, back
 * and up), so sizing the part or a blueprint that nests it stretches the mesh
 * like any other shape; every edit is made in exact millimetres and the box
 * is refitted around the points afterwards. Any other shape can be turned
 * into a mesh to edit it this way. Safe in the browser and on the server.
 */

export const MESH_LIMITS = { points: 4_000, faces: 4_000, perFace: 256 } as const;

export type SculptBrush = "inflate" | "deflate" | "smooth" | "flatten" | "pinch";
export interface SculptStroke { brush: SculptBrush; center: Vec3mm; radius: number; strength: number }

/** A bounded, topology-preserving dab with smooth radial falloff in model mm. */
export function sculptStroke(part: Part, stroke: SculptStroke): Part | string {
  if (!["inflate", "deflate", "smooth", "flatten", "pinch"].includes(stroke.brush)) return "Choose a sculpt brush.";
  if (!Number.isFinite(stroke.radius) || stroke.radius <= 0 || stroke.radius > 100_000 || !Number.isFinite(stroke.strength) || stroke.strength <= 0 || stroke.strength > 1 || !Object.values(stroke.center).every(Number.isFinite)) return "Use a positive radius up to 100,000 mm and strength above 0 up to 1.";
  const m = asMesh(part);
  if (typeof m === "string") return m;
  const center = toPart(m.part, stroke.center);
  const normals: L[] = m.pts.map(() => [0, 0, 0]);
  const neighbours = m.pts.map(() => new Set<number>());
  for (const face of m.faces) {
    const normal = faceNormal(face.map(i => m.pts[i]));
    face.forEach((id, j) => {
      for (let axis = 0; axis < 3; axis++) normals[id][axis] += normal[axis];
      neighbours[id].add(face[(j + 1) % face.length]);
      neighbours[id].add(face[(j + face.length - 1) % face.length]);
    });
  }
  for (const n of normals) { const length = Math.hypot(...n) || 1; for (let axis = 0; axis < 3; axis++) n[axis] /= length; }
  const distances = m.pts.map(p => Math.hypot(p[0] - center[0], p[1] - center[1], p[2] - center[2]));
  const closest = distances.reduce((best, distance, i) => distance < distances[best] ? i : best, 0);
  const plane = normals[closest];
  let affected = 0;
  const next = m.pts.map((p, i): L => {
    const distance = distances[i];
    if (distance >= stroke.radius) return [...p];
    affected++;
    const t = 1 - distance / stroke.radius;
    const weight = t * t * (3 - 2 * t) * stroke.strength;
    if (stroke.brush === "smooth") {
      const adjacent = [...neighbours[i]];
      if (!adjacent.length) return [...p];
      return p.map((value, axis) => value + (adjacent.reduce((sum, id) => sum + m.pts[id][axis], 0) / adjacent.length - value) * weight * .5) as L;
    }
    const planeDistance = p.reduce((sum, v, axis) => sum + (v - center[axis]) * plane[axis], 0);
    if (stroke.brush === "flatten") return p.map((v, axis) => v - plane[axis] * planeDistance * weight) as L;
    if (stroke.brush === "pinch") return p.map((v, axis) => v + (center[axis] - v + plane[axis] * planeDistance) * weight * .5) as L;
    const delta = stroke.radius * .2 * weight * (stroke.brush === "deflate" ? -1 : 1);
    return p.map((v, axis) => v + normals[i][axis] * delta) as L;
  });
  if (!affected) return "No vertices inside the brush radius. Increase the radius or subdivide coarse geometry.";
  return fitted(m.part, next, m.faces);
}

/** One point in the part's own frame (mm): x across from its middle, y back from its middle, z up from its underside. */
type L = [number, number, number];

const r6 = (n: number) => Math.round(n * 1e6) / 1e6;
const r3 = (n: number) => Math.round(n * 1e3) / 1e3;

/** A shape's points and faces in its own frame (mm), before any lean. */
function shapePoints(part: Part): { pts: L[]; faces: number[][] } {
  const { w, d, h } = part.size;
  const taper = part.taper ?? 1;
  const shape = part.shape ?? "box";
  if (shape === "mesh" && part.mesh) return { pts: part.mesh.v.map(([u, v, t]) => [(u - 0.5) * w, (v - 0.5) * d, t * h]), faces: part.mesh.f.map((f) => [...f]) };
  if (shape === "box" || shape === "wedge") {
    const k = shape === "box" ? taper : 1;
    const pts: L[] = [
      [-w / 2, -d / 2, 0],
      [w / 2, -d / 2, 0],
      [w / 2, d / 2, 0],
      [-w / 2, d / 2, 0],
    ];
    if (shape === "box") {
      pts.push([(-w / 2) * k, (-d / 2) * k, h], [(w / 2) * k, (-d / 2) * k, h], [(w / 2) * k, (d / 2) * k, h], [(-w / 2) * k, (d / 2) * k, h]);
      return { pts, faces: [[3, 2, 1, 0], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]] };
    }
    // A wedge rises from the front to full height at the back.
    pts.push([w / 2, d / 2, h], [-w / 2, d / 2, h]);
    return { pts, faces: [[3, 2, 1, 0], [0, 1, 4, 5], [1, 2, 4], [2, 3, 5, 4], [3, 0, 5]] };
  }
  if (shape === "extrude" && part.profile && part.profile.length >= 3) {
    const n = part.profile.length;
    const pts: L[] = [];
    for (const k of [1, taper]) for (const [u, v] of part.profile) pts.push([(u - 0.5) * w * k, (v - 0.5) * d * k, k === 1 && pts.length < n ? 0 : h]);
    const faces = [Array.from({ length: n }, (_, i) => n - 1 - i), Array.from({ length: n }, (_, i) => n + i)];
    for (let i = 0; i < n; i++) faces.push([i, (i + 1) % n, n + ((i + 1) % n), n + i]);
    return { pts, faces };
  }
  if (shape === "sphere") {
    const lat = 8;
    const lon = 16;
    const pts: L[] = [[0, 0, 0]];
    for (let i = 1; i < lat; i++) {
      const a = (i / lat) * Math.PI;
      for (let j = 0; j < lon; j++) {
        const b = (j / lon) * Math.PI * 2;
        pts.push([(Math.sin(a) * Math.cos(b) * w) / 2, (Math.sin(a) * Math.sin(b) * d) / 2, ((1 - Math.cos(a)) * h) / 2]);
      }
    }
    pts.push([0, 0, h]);
    const top = pts.length - 1;
    const ring = (i: number, j: number) => 1 + (i - 1) * lon + (j % lon);
    const faces: number[][] = [];
    for (let j = 0; j < lon; j++) faces.push([0, ring(1, j + 1), ring(1, j)]);
    for (let i = 1; i < lat - 1; i++) for (let j = 0; j < lon; j++) faces.push([ring(i, j), ring(i, j + 1), ring(i + 1, j + 1), ring(i + 1, j)]);
    for (let j = 0; j < lon; j++) faces.push([ring(lat - 1, j), ring(lat - 1, j + 1), top]);
    return { pts, faces };
  }
  // A cylinder (solid or hollow) or a lathe: its outline turned in 24 steps.
  const segments = 24;
  const wall = part.hollow ? part.hollow / (Math.min(w, d) / 2 || 1) : 0;
  const base = part.hollow ? part.hollow / (h || 1) : 0;
  const outline = latheOutline(shape === "lathe" ? part.profile : undefined, { taper: shape === "lathe" ? 1 : taper, wall, base });
  const pts: L[] = [];
  const rings: number[][] = [];
  for (const [r, z] of outline) {
    if (r < 1e-4) {
      pts.push([0, 0, z * h]);
      rings.push(Array(segments).fill(pts.length - 1));
      continue;
    }
    const ids: number[] = [];
    for (let j = 0; j < segments; j++) {
      const b = (j / segments) * Math.PI * 2;
      pts.push([(r * Math.cos(b) * w) / 2, (r * Math.sin(b) * d) / 2, z * h]);
      ids.push(pts.length - 1);
    }
    rings.push(ids);
  }
  const faces: number[][] = [];
  for (let i = 0; i + 1 < rings.length; i++) {
    for (let j = 0; j < segments; j++) {
      const f = [rings[i][j], rings[i][(j + 1) % segments], rings[i + 1][(j + 1) % segments], rings[i + 1][j]];
      const unique = f.filter((x, k) => f.indexOf(x) === k);
      if (unique.length >= 3) faces.push(unique);
    }
  }
  return { pts, faces };
}

/** Leans points as the 3D view leans the shape, about the part's middle. */
function leaned(pts: L[], part: Part): L[] {
  const tx = ((part.tilt?.x ?? 0) * Math.PI) / 180;
  const ty = ((part.tilt?.y ?? 0) * Math.PI) / 180;
  if (!tx && !ty) return pts;
  const c = part.size.h / 2;
  return pts.map(([x, y, z]) => {
    let zz = z - c;
    let yy = y;
    if (tx) [yy, zz] = [yy * Math.cos(tx) + zz * Math.sin(tx), -yy * Math.sin(tx) + zz * Math.cos(tx)];
    let xx = x;
    if (ty) [xx, zz] = [xx * Math.cos(ty) + zz * Math.sin(ty), -xx * Math.sin(ty) + zz * Math.cos(ty)];
    return [xx, yy, zz + c];
  });
}

/** Newell's normal of a polygon: robust for any flat or nearly flat face. */
export function faceNormal(pts: L[]): L {
  let nx = 0;
  let ny = 0;
  let nz = 0;
  for (let i = 0; i < pts.length; i++) {
    const [ax, ay, az] = pts[i];
    const [bx, by, bz] = pts[(i + 1) % pts.length];
    nx += (ay - by) * (az + bz);
    ny += (az - bz) * (ax + bx);
    nz += (ax - bx) * (ay + by);
  }
  const len = Math.hypot(nx, ny, nz) || 1;
  return [nx / len, ny / len, nz / len];
}

const centroid = (pts: L[]): L => {
  const n = pts.length || 1;
  return [pts.reduce((s, p) => s + p[0], 0) / n, pts.reduce((s, p) => s + p[1], 0) / n, pts.reduce((s, p) => s + p[2], 0) / n];
};

/** Turns faces to face outwards, away from the middle of the mesh (right for any convex part, and most others). */
function outward(pts: L[], faces: number[][]): number[][] {
  const mid = centroid(pts);
  return faces.map((f) => {
    const poly = f.map((i) => pts[i]);
    const n = faceNormal(poly);
    const c = centroid(poly);
    const out = (c[0] - mid[0]) * n[0] + (c[1] - mid[1]) * n[1] + (c[2] - mid[2]) * n[2];
    return out < 0 ? [...f].reverse() : f;
  });
}

/** The part as a mesh, its box fitted around points given in its own frame (mm). Points no face uses are dropped. */
function fitted(part: Part, pts: L[], faces: number[][], orient = false): Part | string {
  const keep = faces.filter((f) => f.length >= 3 && new Set(f).size === f.length && f.every((i) => i >= 0 && i < pts.length));
  if (!keep.length) return "A mesh needs at least one face.";
  // Drop unused points, and renumber.
  const used = [...new Set(keep.flat())].sort((a, b) => a - b);
  const index = new Map(used.map((i, k) => [i, k]));
  const P = used.map((i) => pts[i]);
  let F = keep.map((f) => f.map((i) => index.get(i)!));
  if (orient) F = outward(P, F);
  if (P.length > MESH_LIMITS.points) return `A mesh has up to ${MESH_LIMITS.points} points.`;
  if (F.length > MESH_LIMITS.faces) return `A mesh has up to ${MESH_LIMITS.faces} faces.`;
  if (F.some((f) => f.length > MESH_LIMITS.perFace)) return `A face has up to ${MESH_LIMITS.perFace} points.`;
  const xs = P.map((p) => p[0]);
  const ys = P.map((p) => p[1]);
  const zs = P.map((p) => p[2]);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const minZ = Math.min(...zs);
  const w = Math.max(1, Math.max(...xs) - minX);
  const d = Math.max(1, Math.max(...ys) - minY);
  const h = Math.max(1, Math.max(...zs) - minZ);
  if (w > 100_000 || d > 100_000 || h > 100_000) return "A part is up to 100 m each way.";
  // The box's new middle, in the part's frame, moves the part by that much, turned as the part is.
  const cx = minX + w / 2;
  const cy = minY + d / 2;
  const r = (part.rotation * Math.PI) / 180;
  const next: Part = {
    ...part,
    shape: "mesh",
    at: { x: r3(part.at.x + cx * Math.cos(r) - cy * Math.sin(r)), y: r3(part.at.y + cx * Math.sin(r) + cy * Math.cos(r)), z: r3(part.at.z + minZ) },
    size: { w: r3(w), d: r3(d), h: r3(h) },
    mesh: { v: P.map(([x, y, z]) => [r6((x - minX) / w), r6((y - minY) / d), r6((z - minZ) / h)]), f: F },
  };
  delete next.taper;
  delete next.profile;
  delete next.hollow;
  delete next.tilt;
  delete next.radius;
  delete next.blueprintId;
  return next;
}

/** The part's points in its own frame (mm), leaned as it shows. */
export function localPoints(part: Part): L[] {
  return leaned(shapePoints(part).pts, part);
}

/** Any shape part as a mesh with the same look: points and faces to edit one by one. */
export function toMesh(part: Part): Part | string {
  if (part.blueprintId) return "A nested blueprint is edited in its own editor.";
  if (part.shape === "mesh" && part.mesh) return part;
  const { pts, faces } = shapePoints(part);
  return fitted(part, leaned(pts, part), faces, true);
}

/** A point of the part, in the blueprint's frame (mm). */
export function toBlueprint(part: Part, p: L): Vec3mm {
  const r = (part.rotation * Math.PI) / 180;
  return { x: r3(part.at.x + p[0] * Math.cos(r) - p[1] * Math.sin(r)), y: r3(part.at.y + p[0] * Math.sin(r) + p[1] * Math.cos(r)), z: r3(part.at.z + p[2]) };
}

/** A point in the blueprint's frame, in the part's own frame. */
export function toPart(part: Part, p: Vec3mm): L {
  const r = (part.rotation * Math.PI) / 180;
  const x = p.x - part.at.x;
  const y = p.y - part.at.y;
  return [x * Math.cos(r) + y * Math.sin(r), -x * Math.sin(r) + y * Math.cos(r), p.z - part.at.z];
}

/** A mesh part's points in the blueprint's frame (mm). */
export function meshPoints(part: Part): Vec3mm[] {
  return localPoints(part).map((p) => toBlueprint(part, p));
}

/** Each edge once, as point pairs (low index first). */
export function meshEdges(mesh: MeshData): [number, number][] {
  const seen = new Set<string>();
  const out: [number, number][] = [];
  for (const f of mesh.f)
    for (let i = 0; i < f.length; i++) {
      const a = Math.min(f[i], f[(i + 1) % f.length]);
      const b = Math.max(f[i], f[(i + 1) % f.length]);
      const key = `${a},${b}`;
      if (!seen.has(key)) {
        seen.add(key);
        out.push([a, b]);
      }
    }
  return out;
}

/** The faces all of whose points are among these. */
export function facesWithin(mesh: MeshData, points: number[]): number[] {
  const set = new Set(points);
  return mesh.f.flatMap((f, i) => (f.every((p) => set.has(p)) ? [i] : []));
}

function asMesh(part: Part): { part: Part; pts: L[]; faces: number[][] } | string {
  const m = toMesh(part);
  if (typeof m === "string") return m;
  return { part: m, pts: localPoints(m), faces: m.mesh!.f.map((f) => [...f]) };
}

const checkPoints = (pts: L[], ids: number[]) => (ids.length && ids.every((i) => Number.isInteger(i) && i >= 0 && i < pts.length) ? null : "Pick points of this part.");

/** Moves points by a distance given in the blueprint's frame (mm). */
export function movePoints(part: Part, ids: number[], by: Vec3mm): Part | string {
  const m = asMesh(part);
  if (typeof m === "string") return m;
  const bad = checkPoints(m.pts, ids);
  if (bad) return bad;
  const r = (m.part.rotation * Math.PI) / 180;
  const dx = by.x * Math.cos(r) + by.y * Math.sin(r);
  const dy = -by.x * Math.sin(r) + by.y * Math.cos(r);
  const set = new Set(ids);
  return fitted(m.part, m.pts.map((p, i) => (set.has(i) ? [p[0] + dx, p[1] + dy, p[2] + by.z] : p)), m.faces);
}

/** Puts one point exactly at a place in the blueprint's frame (mm). */
export function setPoint(part: Part, id: number, at: Partial<Vec3mm>): Part | string {
  const m = asMesh(part);
  if (typeof m === "string") return m;
  const bad = checkPoints(m.pts, [id]);
  if (bad) return bad;
  const now = toBlueprint(m.part, m.pts[id]);
  const want = { x: at.x ?? now.x, y: at.y ?? now.y, z: at.z ?? now.z };
  if (![want.x, want.y, want.z].every(Number.isFinite)) return "Give the point a place in millimetres.";
  const pts = [...m.pts];
  pts[id] = toPart(m.part, want);
  return fitted(m.part, pts, m.faces);
}

/** Removes points; faces lose them, and a face left with under three points goes. */
export function deletePoints(part: Part, ids: number[]): Part | string {
  const m = asMesh(part);
  if (typeof m === "string") return m;
  const bad = checkPoints(m.pts, ids);
  if (bad) return bad;
  const set = new Set(ids);
  return fitted(m.part, m.pts, m.faces.map((f) => f.filter((i) => !set.has(i))));
}

/** Removes faces; points no face uses go with them. */
export function deleteFaces(part: Part, faces: number[]): Part | string {
  const m = asMesh(part);
  if (typeof m === "string") return m;
  const set = new Set(faces);
  return fitted(m.part, m.pts, m.faces.filter((_, i) => !set.has(i)));
}

/**
 * Adds a point in the middle of each edge between two of these points (or at
 * `t` along it), in every face that has that edge. Returns the new points too.
 */
export function splitEdges(part: Part, ids: number[], t = 0.5): { part: Part; added: number[] } | string {
  const m = asMesh(part);
  if (typeof m === "string") return m;
  const bad = checkPoints(m.pts, ids);
  if (bad) return bad;
  const set = new Set(ids);
  const pts = [...m.pts];
  const made = new Map<string, number>();
  let faces = m.faces;
  for (const [a, b] of meshEdges({ v: [], f: faces })) {
    if (!set.has(a) || !set.has(b)) continue;
    pts.push([pts[a][0] + (pts[b][0] - pts[a][0]) * t, pts[a][1] + (pts[b][1] - pts[a][1]) * t, pts[a][2] + (pts[b][2] - pts[a][2]) * t]);
    made.set(`${a},${b}`, pts.length - 1);
  }
  if (!made.size) return "Pick two points joined by an edge to split it.";
  faces = faces.map((f) => {
    const out: number[] = [];
    f.forEach((p, i) => {
      out.push(p);
      const q = f[(i + 1) % f.length];
      const mid = made.get(`${Math.min(p, q)},${Math.max(p, q)}`);
      if (mid !== undefined) out.push(mid);
    });
    return out;
  });
  // Point numbers survive the refit: only unused points are dropped and every new one is used.
  const next = fitted(m.part, pts, faces);
  if (typeof next === "string") return next;
  const remap = new Map([...new Set(faces.flat())].sort((x, y) => x - y).map((i, k) => [i, k]));
  return { part: next, added: [...made.values()].map((i) => remap.get(i)!) };
}

/** A new face through these points, in the order picked. */
export function makeFace(part: Part, ids: number[]): Part | string {
  const m = asMesh(part);
  if (typeof m === "string") return m;
  const bad = checkPoints(m.pts, ids);
  if (bad) return bad;
  if (new Set(ids).size < 3) return "A face needs three or more points.";
  return fitted(m.part, m.pts, [...m.faces, [...new Set(ids)]], false);
}

/** Joins points into one, at their middle. */
export function mergePoints(part: Part, ids: number[]): Part | string {
  const m = asMesh(part);
  if (typeof m === "string") return m;
  const bad = checkPoints(m.pts, ids);
  if (bad) return bad;
  if (ids.length < 2) return "Pick two or more points to merge.";
  const keep = Math.min(...ids);
  const set = new Set(ids);
  const pts = [...m.pts];
  pts[keep] = centroid(ids.map((i) => m.pts[i]));
  const faces = m.faces.map((f) => {
    const out: number[] = [];
    for (const p of f.map((i) => (set.has(i) ? keep : i))) if (out[out.length - 1] !== p) out.push(p);
    if (out.length > 1 && out[0] === out[out.length - 1]) out.pop();
    return out;
  });
  return fitted(m.part, pts, faces);
}

/** Turns faces over (inside out). */
export function flipFaces(part: Part, faces: number[]): Part | string {
  const m = asMesh(part);
  if (typeof m === "string") return m;
  const set = new Set(faces);
  return fitted(m.part, m.pts, m.faces.map((f, i) => (set.has(i) ? [...f].reverse() : f)));
}

/**
 * Pushes faces out along their facing (or in, for a negative distance), by
 * mm, building sides from their edges: push and pull, as in SketchUp. Faces
 * that share edges move as one. Returns the moved faces' points.
 */
export function extrudeFaces(part: Part, faceIds: number[], distance: number): { part: Part; points: number[] } | string {
  const m = asMesh(part);
  if (typeof m === "string") return m;
  if (!Number.isFinite(distance) || Math.abs(distance) < 0.01) return "Give a distance in millimetres.";
  const chosen = [...new Set(faceIds)].filter((i) => i >= 0 && i < m.faces.length);
  if (!chosen.length) return "Pick a face to push or pull.";
  const pts = [...m.pts];
  // One direction for all: the faces' facing, averaged.
  const normals = chosen.map((i) => faceNormal(m.faces[i].map((p) => pts[p])));
  const avg = centroid(normals);
  const len = Math.hypot(...avg) || 1;
  const dir: L = [(avg[0] / len) * distance, (avg[1] / len) * distance, (avg[2] / len) * distance];
  const copy = new Map<number, number>();
  for (const p of new Set(chosen.flatMap((i) => m.faces[i]))) {
    pts.push([pts[p][0] + dir[0], pts[p][1] + dir[1], pts[p][2] + dir[2]]);
    copy.set(p, pts.length - 1);
  }
  // Edges on the rim of the chosen faces (used once among them) get side faces.
  const count = new Map<string, number>();
  for (const i of chosen) {
    const f = m.faces[i];
    f.forEach((p, k) => {
      const q = f[(k + 1) % f.length];
      const key = `${Math.min(p, q)},${Math.max(p, q)}`;
      count.set(key, (count.get(key) ?? 0) + 1);
    });
  }
  const faces = m.faces.map((f, i) => (chosen.includes(i) ? f.map((p) => copy.get(p)!) : f));
  for (const i of chosen) {
    const f = m.faces[i];
    f.forEach((p, k) => {
      const q = f[(k + 1) % f.length];
      if (count.get(`${Math.min(p, q)},${Math.max(p, q)}`) === 1) faces.push(distance > 0 ? [p, q, copy.get(q)!, copy.get(p)!] : [q, p, copy.get(p)!, copy.get(q)!]);
    });
  }
  // Pulled inwards, the sides face the other way round.
  const next = fitted(m.part, pts, faces);
  if (typeof next === "string") return next;
  const remap = new Map([...new Set(faces.flat())].sort((x, y) => x - y).map((i, k) => [i, k]));
  return { part: next, points: [...copy.values()].map((i) => remap.get(i)!) };
}

/** Distances that matter while editing: an edge's length, between two points, as the 2D drawings measure. */
export function distance(a: Vec3mm, b: Vec3mm): number {
  return Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
}

/**
 * Splits a flat polygon into triangles (ear clipping), for drawing faces of
 * any shape, concave ones too. Points are in 3D; the polygon is laid flat on
 * the plane it mostly faces. Returns index triples into `pts`.
 */
export function triangulate(pts: L[]): [number, number, number][] {
  const n = pts.length;
  if (n < 3) return [];
  if (n === 3) return [[0, 1, 2]];
  const [nx, ny, nz] = faceNormal(pts);
  const ax = Math.abs(nx);
  const ay = Math.abs(ny);
  const az = Math.abs(nz);
  // Drop the axis the face is most across, keeping the winding the normal gives.
  const flat: [number, number][] =
    az >= ax && az >= ay ? pts.map((p) => (nz >= 0 ? [p[0], p[1]] : [p[1], p[0]])) : ax >= ay ? pts.map((p) => (nx >= 0 ? [p[1], p[2]] : [p[2], p[1]])) : pts.map((p) => (ny >= 0 ? [p[2], p[0]] : [p[0], p[2]]));
  const cross = (o: [number, number], a: [number, number], b: [number, number]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const inside = (p: [number, number], a: [number, number], b: [number, number], c: [number, number]) => cross(a, b, p) >= -1e-9 && cross(b, c, p) >= -1e-9 && cross(c, a, p) >= -1e-9;
  const idx = Array.from({ length: n }, (_, i) => i);
  const out: [number, number, number][] = [];
  let guard = n * n;
  while (idx.length > 3 && guard-- > 0) {
    let clipped = false;
    for (let k = 0; k < idx.length; k++) {
      const i0 = idx[(k + idx.length - 1) % idx.length];
      const i1 = idx[k];
      const i2 = idx[(k + 1) % idx.length];
      const a = flat[i0];
      const b = flat[i1];
      const c = flat[i2];
      if (cross(a, b, c) <= 1e-12) continue;
      if (idx.some((j) => j !== i0 && j !== i1 && j !== i2 && inside(flat[j], a, b, c))) continue;
      out.push([i0, i1, i2]);
      idx.splice(k, 1);
      clipped = true;
      break;
    }
    // A twisted or degenerate face: fan the rest so nothing disappears.
    if (!clipped) break;
  }
  for (let k = 1; k + 1 < idx.length; k++) out.push([idx[0], idx[k], idx[k + 1]]);
  return out;
}

/**
 * Insets faces inward by distance mm (or proportional offset), creating a recessed/raised
 * perimeter frame ring and a new inset face: the foundational tool for panels, window panes,
 * bezels and chamfered recesses.
 */
export function insetFaces(part: Part, faceIds: number[], distanceMm: number): { part: Part; points: number[]; faces: number[] } | string {
  const m = asMesh(part);
  if (typeof m === "string") return m;
  const dist = Math.abs(distanceMm) || 20;
  const chosen = [...new Set(faceIds)].filter((i) => i >= 0 && i < m.faces.length);
  if (!chosen.length) return "Pick at least one face to inset.";

  const pts = [...m.pts];
  const newFaces = [...m.faces];
  const addedPoints: number[] = [];
  const insetFaceIds: number[] = [];

  for (const fIdx of chosen) {
    const face = m.faces[fIdx];
    const poly = face.map((p) => pts[p]);
    const center = centroid(poly);

    const innerIndices: number[] = [];
    for (let j = 0; j < face.length; j++) {
      const p = poly[j];
      const dx = center[0] - p[0];
      const dy = center[1] - p[1];
      const dz = center[2] - p[2];
      const len = Math.hypot(dx, dy, dz) || 1;
      const ratio = Math.min(0.85, Math.max(0.05, dist / len));
      const q: L = [p[0] + dx * ratio, p[1] + dy * ratio, p[2] + dz * ratio];
      pts.push(q);
      const newIdx = pts.length - 1;
      innerIndices.push(newIdx);
      addedPoints.push(newIdx);
    }

    // Replace old face with inner face
    newFaces[fIdx] = innerIndices;
    insetFaceIds.push(fIdx);

    // Add bridging quads around perimeter
    const k = face.length;
    for (let j = 0; j < k; j++) {
      const nextJ = (j + 1) % k;
      newFaces.push([face[j], face[nextJ], innerIndices[nextJ], innerIndices[j]]);
    }
  }

  const next = fitted(m.part, pts, newFaces);
  if (typeof next === "string") return next;
  const remap = new Map([...new Set(newFaces.flat())].sort((x, y) => x - y).map((i, k) => [i, k]));
  return {
    part: next,
    points: addedPoints.map((i) => remap.get(i)!),
    faces: insetFaceIds,
  };
}

/**
 * Subdivides faces: splits quads into 4 quads, triangles into 3 quads,
 * doubling local resolution and enabling high-detail sculpting and smoothing.
 */
export function subdivideFaces(part: Part, faceIds?: number[]): Part | string {
  const m = asMesh(part);
  if (typeof m === "string") return m;
  const chosenSet = faceIds && faceIds.length ? new Set(faceIds) : null;
  const pts = [...m.pts];
  const edgeMid = new Map<string, number>();

  const getMid = (a: number, b: number): number => {
    const key = `${Math.min(a, b)},${Math.max(a, b)}`;
    const found = edgeMid.get(key);
    if (found !== undefined) return found;
    const mid: L = [
      (pts[a][0] + pts[b][0]) / 2,
      (pts[a][1] + pts[b][1]) / 2,
      (pts[a][2] + pts[b][2]) / 2,
    ];
    pts.push(mid);
    const idx = pts.length - 1;
    edgeMid.set(key, idx);
    return idx;
  };

  const newFaces: number[][] = [];
  m.faces.forEach((face, idx) => {
    if (chosenSet && !chosenSet.has(idx)) {
      newFaces.push(face);
      return;
    }
    const poly = face.map((p) => pts[p]);
    const centerPt = centroid(poly);
    pts.push(centerPt);
    const centerIdx = pts.length - 1;

    const n = face.length;
    for (let i = 0; i < n; i++) {
      const prev = face[(i + n - 1) % n];
      const curr = face[i];
      const next = face[(i + 1) % n];

      const midPrev = getMid(prev, curr);
      const midNext = getMid(curr, next);

      newFaces.push([curr, midNext, centerIdx, midPrev]);
    }
  });

  return fitted(m.part, pts, newFaces);
}

/**
 * Aligns picked points to a single plane along an axis in blueprint mm (min, center, or max).
 */
export function alignPoints(part: Part, ids: number[], axis: "x" | "y" | "z", mode: "min" | "center" | "max" = "center"): Part | string {
  const m = asMesh(part);
  if (typeof m === "string") return m;
  const bad = checkPoints(m.pts, ids);
  if (bad) return bad;

  const worldPts = ids.map((id) => toBlueprint(m.part, m.pts[id]));
  const vals = worldPts.map((p) => p[axis]);
  const targetVal = mode === "min" ? Math.min(...vals) : mode === "max" ? Math.max(...vals) : vals.reduce((s, v) => s + v, 0) / vals.length;

  const pts = [...m.pts];
  for (const id of ids) {
    const curWorld = toBlueprint(m.part, pts[id]);
    pts[id] = toPart(m.part, { ...curWorld, [axis]: targetVal });
  }

  return fitted(m.part, pts, m.faces);
}

/**
 * Welds / merges vertices within a threshold distance (mm) of each other,
 * cleaning up doubled vertices after operations or slicing.
 */
export function weldPoints(part: Part, thresholdMm = 2): Part | string {
  const m = asMesh(part);
  if (typeof m === "string") return m;
  const thresh = Math.max(0.1, thresholdMm);
  const pts = [...m.pts];
  const targetMap = new Map<number, number>();

  for (let i = 0; i < pts.length; i++) {
    if (targetMap.has(i)) continue;
    targetMap.set(i, i);
    const pi = pts[i];
    for (let j = i + 1; j < pts.length; j++) {
      if (targetMap.has(j)) continue;
      const pj = pts[j];
      const dist = Math.hypot(pj[0] - pi[0], pj[1] - pi[1], pj[2] - pi[2]);
      if (dist <= thresh) targetMap.set(j, i);
    }
  }

  const newFaces = m.faces.map((f) => {
    const remapped: number[] = [];
    for (const p of f) {
      const t = targetMap.get(p) ?? p;
      if (!remapped.length || remapped[remapped.length - 1] !== t) remapped.push(t);
    }
    if (remapped.length > 2 && remapped[0] === remapped[remapped.length - 1]) remapped.pop();
    return remapped;
  });

  return fitted(m.part, pts, newFaces);
}

/**
 * Inserts a vertex directly on a face at its centroid (optionally elevated along
 * the face normal by offsetMm to form a peak or recess), splitting the polygon
 * into a radial fan of triangles connected to the new point.
 */
export function addVertexOnFace(
  part: Part,
  faceId: number,
  offsetMm = 0
): { part: Part; point: number; faces: number[] } | string {
  const m = asMesh(part);
  if (typeof m === "string") return m;
  if (faceId < 0 || faceId >= m.faces.length) return "Pick a valid face.";

  const face = m.faces[faceId];
  if (face.length < 3) return "A face needs at least 3 vertices.";

  const pts = [...m.pts];
  const poly = face.map((i) => pts[i]);
  const center = centroid(poly);
  const normal = faceNormal(poly);

  const newPt: L = [
    center[0] + normal[0] * offsetMm,
    center[1] + normal[1] * offsetMm,
    center[2] + normal[2] * offsetMm,
  ];
  pts.push(newPt);
  const newPtIdx = pts.length - 1;

  const n = face.length;
  const newFaces: number[][] = [];
  m.faces.forEach((f, idx) => {
    if (idx !== faceId) {
      newFaces.push(f);
      return;
    }
    for (let i = 0; i < n; i++) {
      const nextI = (i + 1) % n;
      newFaces.push([face[i], face[nextI], newPtIdx]);
    }
  });

  const next = fitted(m.part, pts, newFaces);
  if (typeof next === "string") return next;
  const remap = new Map([...new Set(newFaces.flat())].sort((x, y) => x - y).map((i, k) => [i, k]));
  const remappedNewPt = remap.get(newPtIdx)!;
  return {
    part: next,
    point: remappedNewPt,
    faces: Array.from({ length: n }, (_, i) => faceId + i),
  };
}

/**
 * Scales selected vertices towards or away from their centroid by a factor
 * (e.g. 0.8 for tapering, 1.25 for flaring/bulging).
 */
export function scalePoints(part: Part, ids: number[], factor: number): Part | string {
  const m = asMesh(part);
  if (typeof m === "string") return m;
  const bad = checkPoints(m.pts, ids);
  if (bad) return bad;
  if (!Number.isFinite(factor) || factor <= 0) return "Give a positive scale factor.";

  const pickedPts = ids.map((i) => m.pts[i]);
  const center = centroid(pickedPts);

  const set = new Set(ids);
  const pts: L[] = m.pts.map((p, i) => {
    if (!set.has(i)) return p;
    return [
      center[0] + (p[0] - center[0]) * factor,
      center[1] + (p[1] - center[1]) * factor,
      center[2] + (p[2] - center[2]) * factor,
    ];
  });

  return fitted(m.part, pts, m.faces);
}

/**
 * Rotates selected vertices around their centroid in the given axis plane by degrees
 * (enables twisting, spiraling, and curved freeform features).
 */
export function rotatePoints(part: Part, ids: number[], axis: "x" | "y" | "z", degrees: number): Part | string {
  const m = asMesh(part);
  if (typeof m === "string") return m;
  const bad = checkPoints(m.pts, ids);
  if (bad) return bad;
  if (!Number.isFinite(degrees)) return "Give a rotation in degrees.";

  const rad = (degrees * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);

  const pickedPts = ids.map((i) => m.pts[i]);
  const center = centroid(pickedPts);

  const set = new Set(ids);
  const pts: L[] = m.pts.map((p, i) => {
    if (!set.has(i)) return p;
    const dx = p[0] - center[0];
    const dy = p[1] - center[1];
    const dz = p[2] - center[2];

    let rx = dx;
    let ry = dy;
    let rz = dz;

    if (axis === "z") {
      rx = dx * cos - dy * sin;
      ry = dx * sin + dy * cos;
    } else if (axis === "x") {
      ry = dy * cos - dz * sin;
      rz = dy * sin + dz * cos;
    } else {
      rx = dx * cos + dz * sin;
      rz = -dx * sin + dz * cos;
    }

    return [center[0] + rx, center[1] + ry, center[2] + rz];
  });

  return fitted(m.part, pts, m.faces);
}

/**
 * Laplacian mesh smoothing/relaxation: iteratively shifts selected vertices toward
 * the center of their connected topological neighbors for smooth, organic sculpting.
 */
export function smoothPoints(part: Part, ids: number[], iterations = 1, factor = 0.5): Part | string {
  const m = asMesh(part);
  if (typeof m === "string") return m;
  const bad = checkPoints(m.pts, ids);
  if (bad) return bad;

  const set = new Set(ids);
  let pts = [...m.pts];

  const neighbors = new Map<number, Set<number>>();
  for (const f of m.faces) {
    for (let i = 0; i < f.length; i++) {
      const a = f[i];
      const b = f[(i + 1) % f.length];
      if (!neighbors.has(a)) neighbors.set(a, new Set());
      if (!neighbors.has(b)) neighbors.set(b, new Set());
      neighbors.get(a)!.add(b);
      neighbors.get(b)!.add(a);
    }
  }

  const iters = Math.max(1, Math.min(10, iterations));
  const alpha = Math.max(0.05, Math.min(0.95, factor));

  for (let it = 0; it < iters; it++) {
    const nextPts: L[] = pts.map((p, i) => {
      if (!set.has(i)) return p;
      const nbs = neighbors.get(i);
      if (!nbs || !nbs.size) return p;
      let sx = 0;
      let sy = 0;
      let sz = 0;
      for (const nb of nbs) {
        sx += pts[nb][0];
        sy += pts[nb][1];
        sz += pts[nb][2];
      }
      const count = nbs.size;
      const avg: L = [sx / count, sy / count, sz / count];
      return [
        p[0] * (1 - alpha) + avg[0] * alpha,
        p[1] * (1 - alpha) + avg[1] * alpha,
        p[2] * (1 - alpha) + avg[2] * alpha,
      ];
    });
    pts = nextPts;
  }

  return fitted(m.part, pts, m.faces);
}

/**
 * Triangulates polygons/quads into triangles for low-poly styling and facet modeling.
 */
export function triangulateFaces(part: Part, faceIds?: number[]): Part | string {
  const m = asMesh(part);
  if (typeof m === "string") return m;

  const targetSet = faceIds && faceIds.length ? new Set(faceIds) : null;
  const newFaces: number[][] = [];

  m.faces.forEach((f, idx) => {
    if ((targetSet && !targetSet.has(idx)) || f.length === 3) {
      newFaces.push(f);
      return;
    }
    const poly = f.map((i) => m.pts[i]);
    const tris = triangulate(poly);
    for (const [a, b, c] of tris) {
      newFaces.push([f[a], f[b], f[c]]);
    }
  });

  return fitted(m.part, m.pts, newFaces);
}


