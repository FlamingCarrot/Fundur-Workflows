import { flatten, type Resolver } from "@/lib/blueprints/resolve";
import { toMesh, triangulate } from "@/lib/blueprints/mesh";
import type { Blueprint } from "@/lib/blueprints/types";

export function inspectGameAsset(lib: Resolver, bp: Blueprint) {
  let triangles = 0;
  let vertices = 0;
  const issues: string[] = [];
  const primitives = flatten(lib, bp);
  for (const p of primitives) {
    const mesh = toMesh({ id: "inspect", shape: p.shape, at: { x: p.x, y: p.y, z: p.z },
      size: { w: p.w, d: p.d, h: p.h }, rotation: p.rotation * 180 / Math.PI,
      mesh: p.mesh, profile: p.profile, taper: p.taper, hollow: p.hollow, radius: p.radius });
    if (typeof mesh === "string" || !mesh.mesh) { issues.push("A shape could not be converted to mesh geometry."); continue; }
    vertices += mesh.mesh.v.length;
    for (const face of mesh.mesh.f) triangles += triangulate(face.map(i => mesh.mesh!.v[i])).length;
  }
  if (!primitives.length) issues.push("No model geometry yet.");
  if (bp.gameAsset && triangles > bp.gameAsset.targetTriangles) issues.push(`Over the ${bp.gameAsset.targetTriangles.toLocaleString()} triangle budget.`);
  // These are production requirements, never claims that a generator completed them.
  const pending = ["UV unwrap and texture baking", "LOD generation and target hardware profiling", "Engine import, scale and pivot verification"];
  if (bp.gameAsset?.collision !== "none") pending.push("Collision geometry and physics verification");
  if (bp.gameAsset?.rigging !== "static") pending.push("Skeleton, skin weights and animation verification");
  return { triangles, vertices, parts: primitives.length, issues, pending };
}
