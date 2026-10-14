import { type Resolver } from "./resolve";
import { faceNormal, triangulate, toMesh } from "./mesh";
import type { Blueprint, Part } from "./types";
import { blankBlueprint } from "./edit";

/**
 * 3D Model Export and Import module for the Blueprint Modeling Engine.
 * Supports standard CAD and 3D printing interchange formats:
 * - Wavefront OBJ (.obj)
 * - Stereolithography (.stl)
 * - Blueprint JSON (.json)
 */

interface Vertex3 {
  x: number;
  y: number;
  z: number;
}

interface PolygonFace {
  indices: number[];
  normal: [number, number, number];
}

interface ObjectGeometry {
  name: string;
  vertices: Vertex3[];
  faces: PolygonFace[];
}

function resolvePartGeometry(part: Part): ObjectGeometry {
  const m = toMesh(part);
  if (typeof m === "string" || !m.mesh) {
    return { name: part.name ?? "Part", vertices: [], faces: [] };
  }

  const { w, d, h } = m.size;
  const r = (m.rotation * Math.PI) / 180;
  const cosR = Math.cos(r);
  const sinR = Math.sin(r);

  const vertices: Vertex3[] = m.mesh.v.map(([u, v, t]) => {
    const lx = (u - 0.5) * w;
    const ly = (v - 0.5) * d;
    const lz = t * h;
    return {
      x: Math.round((m.at.x + lx * cosR - ly * sinR) * 10) / 10,
      y: Math.round((m.at.y + lx * sinR + ly * cosR) * 10) / 10,
      z: Math.round((m.at.z + lz) * 10) / 10,
    };
  });

  const faces: PolygonFace[] = [];
  for (const f of m.mesh.f) {
    const poly: [number, number, number][] = f.map((idx) => [vertices[idx].x, vertices[idx].y, vertices[idx].z]);
    if (poly.length < 3) continue;
    const normal = faceNormal(poly);
    faces.push({ indices: f, normal });
  }

  return { name: m.name ?? "Part", vertices, faces };
}

/**
 * Exports blueprint parts as a complete Wavefront OBJ string.
 * Coordinates are in millimeters (Z up, as standard architectural coordinates).
 */
export function exportToOBJ(lib: Resolver, bp: Blueprint): string {
  const lines: string[] = [
    `# Wavefront OBJ exported from Fundur 3D Modeling Engine`,
    `# Blueprint: ${bp.name}`,
    `# Units: mm`,
    `# Revision: ${bp.revision}`,
    "",
  ];

  let vertexOffset = 1;
  let normalOffset = 1;

  for (const part of bp.parts) {
    if (part.blueprintId) {
      // Nested blueprint: flatten its child shapes
      const child = lib.blueprint(part.blueprintId);
      if (child) {
        lines.push(`g ${part.name ?? child.name}`);
        for (const cp of child.parts) {
          const geom = resolvePartGeometry({
            ...cp,
            at: { x: part.at.x + cp.at.x, y: part.at.y + cp.at.y, z: part.at.z + cp.at.z },
          });
          if (!geom.vertices.length) continue;
          lines.push(`o ${geom.name}`);
          for (const v of geom.vertices) lines.push(`v ${v.x} ${v.y} ${v.z}`);
          for (const f of geom.faces) lines.push(`vn ${f.normal[0]} ${f.normal[1]} ${f.normal[2]}`);
          for (let i = 0; i < geom.faces.length; i++) {
            const f = geom.faces[i];
            const vnIdx = normalOffset + i;
            const faceStr = f.indices.map((idx) => `${vertexOffset + idx}//${vnIdx}`).join(" ");
            lines.push(`f ${faceStr}`);
          }
          vertexOffset += geom.vertices.length;
          normalOffset += geom.faces.length;
        }
      }
      continue;
    }

    const geom = resolvePartGeometry(part);
    if (!geom.vertices.length) continue;

    lines.push(`o ${geom.name}`);
    for (const v of geom.vertices) lines.push(`v ${v.x} ${v.y} ${v.z}`);
    for (const f of geom.faces) lines.push(`vn ${f.normal[0]} ${f.normal[1]} ${f.normal[2]}`);
    for (let i = 0; i < geom.faces.length; i++) {
      const f = geom.faces[i];
      const vnIdx = normalOffset + i;
      const faceStr = f.indices.map((idx) => `${vertexOffset + idx}//${vnIdx}`).join(" ");
      lines.push(`f ${faceStr}`);
    }

    vertexOffset += geom.vertices.length;
    normalOffset += geom.faces.length;
  }

  return lines.join("\n");
}

/**
 * Exports blueprint as an ASCII STL string for 3D printing slicers.
 */
export function exportToSTL(lib: Resolver, bp: Blueprint): string {
  const safeName = bp.name.replace(/[^a-zA-Z0-9_-]/g, "_") || "model";
  const lines: string[] = [`solid ${safeName}`];

  for (const part of bp.parts) {
    const geom = resolvePartGeometry(part);
    if (!geom.vertices.length) continue;

    for (const face of geom.faces) {
      const poly: [number, number, number][] = face.indices.map((idx) => [
        geom.vertices[idx].x,
        geom.vertices[idx].y,
        geom.vertices[idx].z,
      ]);
      const tris = triangulate(poly);
      const [nx, ny, nz] = face.normal;

      for (const [i0, i1, i2] of tris) {
        const p0 = geom.vertices[face.indices[i0]];
        const p1 = geom.vertices[face.indices[i1]];
        const p2 = geom.vertices[face.indices[i2]];

        lines.push(`  facet normal ${nx} ${ny} ${nz}`);
        lines.push(`    outer loop`);
        lines.push(`      vertex ${p0.x} ${p0.y} ${p0.z}`);
        lines.push(`      vertex ${p1.x} ${p1.y} ${p1.z}`);
        lines.push(`      vertex ${p2.x} ${p2.y} ${p2.z}`);
        lines.push(`    endloop`);
        lines.push(`  endfacet`);
      }
    }
  }

  lines.push(`endsolid ${safeName}`);
  return lines.join("\n");
}

/**
 * Exports blueprint JSON with formatting.
 */
export function exportToJSON(bp: Blueprint): string {
  return JSON.stringify(bp, null, 2);
}

/**
 * Parses a Wavefront OBJ string and creates a Blueprint with mesh parts.
 */
export function importFromOBJ(objText: string, modelName = "Imported Model"): Omit<Blueprint, "id"> {
  const lines = objText.split(/\r?\n/);
  const rawVertices: [number, number, number][] = [];
  const rawFaces: number[][] = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    if (line.startsWith("v ")) {
      const parts = line.slice(2).trim().split(/\s+/).map(Number);
      if (parts.length >= 3 && parts.every(Number.isFinite)) {
        rawVertices.push([parts[0], parts[1], parts[2]]);
      }
    } else if (line.startsWith("f ")) {
      const parts = line.slice(2).trim().split(/\s+/);
      const faceVerts: number[] = [];
      for (const p of parts) {
        const vIdxStr = p.split("/")[0];
        const vIdx = parseInt(vIdxStr, 10);
        if (Number.isInteger(vIdx)) {
          // OBJ indices are 1-based, or negative relative
          const actual = vIdx > 0 ? vIdx - 1 : rawVertices.length + vIdx;
          if (actual >= 0 && actual < rawVertices.length) {
            faceVerts.push(actual);
          }
        }
      }
      if (faceVerts.length >= 3) {
        rawFaces.push(faceVerts);
      }
    }
  }

  if (rawVertices.length < 3 || rawFaces.length < 1) {
    return blankBlueprint(modelName);
  }

  // Calculate bounding box
  const xs = rawVertices.map((v) => v[0]);
  const ys = rawVertices.map((v) => v[1]);
  const zs = rawVertices.map((v) => v[2]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const minZ = Math.min(...zs);
  const maxZ = Math.max(...zs);

  const w = Math.max(1, maxX - minX);
  const d = Math.max(1, maxY - minY);
  const h = Math.max(1, maxZ - minZ);

  const r6 = (n: number) => Math.round(n * 1e6) / 1e6;
  const normalizedV: [number, number, number][] = rawVertices.map(([x, y, z]) => [
    r6((x - minX) / w),
    r6((y - minY) / d),
    r6((z - minZ) / h),
  ]);

  const partId = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10);
  const part: Part = {
    id: partId,
    name: "Imported Mesh",
    shape: "mesh",
    at: { x: 0, y: 0, z: 0 },
    size: { w: Math.round(w), d: Math.round(d), h: Math.round(h) },
    rotation: 0,
    material: "std:warm-grey-paint",
    mesh: { v: normalizedV, f: rawFaces },
  };

  return {
    name: modelName,
    kind: "object",
    category: "Other",
    type: "box",
    size: { w: Math.round(w), d: Math.round(d), h: Math.round(h) },
    parts: [part],
    symbol: "parts",
    revision: 0,
  };
}
