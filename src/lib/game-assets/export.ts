import { flatten, type Resolver } from "@/lib/blueprints/resolve";
import { meshPoints, toMesh, triangulate } from "@/lib/blueprints/mesh";
import type { Blueprint, Material } from "@/lib/blueprints/types";

const linearColor = (hex: string) => [1, 3, 5].map(start => { const s = parseInt(hex.slice(start, start + 2), 16) / 255; return s <= .04045 ? s / 12.92 : ((s + .055) / 1.055) ** 2.4; });

function physicalExtensions(mat: Material | undefined): Record<string, unknown> {
  if (!mat) return {};
  const extensions: Record<string, unknown> = {};
  if (mat.clearcoat) extensions.KHR_materials_clearcoat = { clearcoatFactor: mat.clearcoat, clearcoatRoughnessFactor: mat.clearcoatRoughness ?? .1 };
  if (mat.sheen) extensions.KHR_materials_sheen = { sheenColorFactor: linearColor(mat.sheenColor ?? "#ffffff").map(v => v * mat.sheen!), sheenRoughnessFactor: .7 };
  if (mat.transmission) {
    extensions.KHR_materials_transmission = { transmissionFactor: mat.transmission };
    if (mat.thickness) extensions.KHR_materials_volume = { thicknessFactor: mat.thickness / 1000, attenuationColor: linearColor(mat.attenuationColor ?? "#ffffff"), ...(mat.attenuationDistance != null ? { attenuationDistance: mat.attenuationDistance / 1000 } : {}) };
  }
  if (mat.ior != null) extensions.KHR_materials_ior = { ior: mat.ior };
  if (mat.iridescence) extensions.KHR_materials_iridescence = { iridescenceFactor: mat.iridescence };
  return extensions;
}

/** Self-contained glTF 2.0: draft geometry + PBR factors, metres and Y up.
 * Procedural materials / photo textures need UVs and baking before delivery. */
export function exportGameGLTF(lib: Resolver, bp: Blueprint): string {
  const chunks: Uint8Array[] = [];
  const bufferViews: { buffer: number; byteOffset: number; byteLength: number; target: number }[] = [];
  const accessors: { bufferView: number; componentType: number; count: number; type: string; min?: number[]; max?: number[] }[] = [];
  const meshes: { name: string; primitives: { attributes: { POSITION: number; NORMAL: number }; material: number; mode: number }[] }[] = [];
  const materials: Record<string, unknown>[] = [];
  const extensionsUsed = new Set<string>();
  const nodes: { name: string; mesh: number }[] = [];
  let offset = 0;
  function attribute(values: number[], positions = false) {
    const bytes = new Uint8Array(values.length * 4);
    const view = new DataView(bytes.buffer);
    values.forEach((value, i) => view.setFloat32(i * 4, value, true));
    const index = accessors.length;
    bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length, target: 34962 });
    const a: (typeof accessors)[number] = { bufferView: bufferViews.length - 1, componentType: 5126, count: values.length / 3, type: "VEC3" };
    if (positions) {
      a.min = [Infinity, Infinity, Infinity]; a.max = [-Infinity, -Infinity, -Infinity];
      values.forEach((v, i) => { const axis = i % 3; a.min![axis] = Math.min(a.min![axis], v); a.max![axis] = Math.max(a.max![axis], v); });
    }
    accessors.push(a); chunks.push(bytes); offset += bytes.length;
    return index;
  }
  for (const [i, p] of flatten(lib, bp).entries()) {
    const mesh = toMesh({ id: `part-${i}`, shape: p.shape, at: { x: p.x, y: p.y, z: p.z }, size: { w: p.w, d: p.d, h: p.h },
      rotation: p.rotation * 180 / Math.PI, mesh: p.mesh, profile: p.profile, taper: p.taper, hollow: p.hollow, radius: p.radius,
      tilt: { x: (p.tiltX ?? 0) * 180 / Math.PI, y: (p.tiltY ?? 0) * 180 / Math.PI } });
    if (typeof mesh === "string" || !mesh.mesh) throw new Error("An asset shape could not be exported.");
    const points = meshPoints(mesh).map(v => [v.x / 1000, v.z / 1000, -v.y / 1000] as [number, number, number]);
    const positions: number[] = [];
    const normals: number[] = [];
    for (const face of mesh.mesh.f) {
      const polygon = face.map(v => points[v]);
      for (const [a, b, c] of triangulate(polygon)) {
        const v0 = polygon[a], v1 = polygon[b], v2 = polygon[c];
        const u = v1.map((v, j) => v - v0[j]), v = v2.map((n, j) => n - v0[j]);
        const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
        const length = Math.hypot(...n);
        if (length < 1e-12) continue;
        positions.push(...v0, ...v1, ...v2);
        for (let j = 0; j < 3; j++) normals.push(...n.map(x => x / length));
      }
    }
    if (!positions.length) continue;
    const mat = p.material ? lib.material(p.material) : undefined;
    const hex = mat?.color ?? "#b5b5ae";
    // glTF factors are linear, while library colours are sRGB.
    const color = linearColor(hex);
    const extensions = physicalExtensions(mat);
    Object.keys(extensions).forEach(name => extensionsUsed.add(name));
    materials.push({ name: mat?.name ?? "Default", pbrMetallicRoughness: { baseColorFactor: [...color, mat?.opacity ?? 1], metallicFactor: mat?.metalness ?? 0, roughnessFactor: mat?.roughness ?? .8 }, alphaMode: (mat?.opacity ?? 1) < 1 ? "BLEND" : "OPAQUE", doubleSided: false,
      ...(Object.keys(extensions).length ? { extensions } : {}),
      ...(mat?.subsurface ? { extras: { fundurSubsurface: { amount: mat.subsurface, color: mat.subsurfaceColor ?? "#ffb08a", radiusMm: mat.subsurfaceRadius ?? 3, thicknessMm: mat.thickness ?? 1, previewOnly: true, note: "Fast direct-light approximation; rebuild and validate the scattering shader in the target engine." } } } : {}),
    });
    const name = p.path.join("/");
    meshes.push({ name, primitives: [{ attributes: { POSITION: attribute(positions, true), NORMAL: attribute(normals) }, material: materials.length - 1, mode: 4 }] });
    nodes.push({ name, mesh: meshes.length - 1 });
  }
  if (!meshes.length) throw new Error("Build model geometry before exporting.");
  const bytes = new Uint8Array(offset);
  let at = 0; for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.length; }
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return JSON.stringify({ asset: { version: "2.0", generator: "Fundur game asset studio" }, scene: 0,
    scenes: [{ name: bp.name, nodes: nodes.map((_, i) => i) }], nodes, meshes, materials, accessors, bufferViews,
    ...(extensionsUsed.size ? { extensionsUsed: [...extensionsUsed] } : {}),
    buffers: [{ byteLength: bytes.length, uri: `data:application/octet-stream;base64,${btoa(binary)}` }],
    extras: { blueprintId: bp.id, revision: bp.revision, gameAsset: bp.gameAsset,
      deliveryStatus: "draft", limitations: ["Geometry and material factors only; image textures and procedural patterns are not baked.", "UVs, LODs, collisions, rigs and animations require production work and target-engine verification."] },
  }, null, 2);
}
