import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import type { Resolver } from "@/lib/blueprints/resolve";
import { CLAY } from "@/lib/blueprints/materials";
import type { Solid } from "@/lib/plan/scene";
import type { ViewStyle } from "@/lib/plan/geometry";
import { textureFor } from "./textures";

/**
 * Turns the scene's solids into three.js meshes in a chosen look: realistic
 * (materials and textures), a gray model (one clay colour, for checking form
 * and for AI renders), or lines (white with black edges, like a drawing).
 */

/** Texture coordinates in metres from the side each face points to, so textures keep their real size on any shape. */
function projectUVs(geometry: THREE.BufferGeometry) {
  const pos = geometry.getAttribute("position");
  const normal = geometry.getAttribute("normal");
  if (!pos || !normal) return;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const nx = Math.abs(normal.getX(i));
    const ny = Math.abs(normal.getY(i));
    const nz = Math.abs(normal.getZ(i));
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    if (ny >= nx && ny >= nz) {
      uv[i * 2] = x;
      uv[i * 2 + 1] = z;
    } else if (nx >= nz) {
      uv[i * 2] = z;
      uv[i * 2 + 1] = y;
    } else {
      uv[i * 2] = x;
      uv[i * 2 + 1] = y;
    }
  }
  geometry.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
}

function wedge(w: number, h: number, d: number): THREE.BufferGeometry {
  // Rises from the front (-y on the plan) to full height at the back.
  const shape = new THREE.Shape();
  shape.moveTo(-d / 2, -h / 2);
  shape.lineTo(d / 2, -h / 2);
  shape.lineTo(d / 2, h / 2);
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, { depth: w, bevelEnabled: false });
  g.translate(0, 0, -w / 2);
  g.rotateY(Math.PI / 2);
  return g;
}

export function geometryFor(solid: Solid): THREE.BufferGeometry {
  const [w, h, d] = solid.size;
  let geometry: THREE.BufferGeometry;
  if (solid.shape === "floor") {
    const shape = new THREE.Shape();
    solid.points!.forEach(([x, y], i) => (i ? shape.lineTo(x, y) : shape.moveTo(x, y)));
    shape.closePath();
    geometry = new THREE.ExtrudeGeometry(shape, { depth: solid.size[1], bevelEnabled: false, steps: 1 });
    geometry.rotateX(-Math.PI / 2);
    return geometry;
  }
  if (solid.shape === "cylinder") {
    geometry = new THREE.CylinderGeometry(w / 2, w / 2, h, 32);
    geometry.scale(1, 1, d / (w || 1));
  } else if (solid.shape === "sphere") {
    geometry = new THREE.SphereGeometry(0.5, 32, 18);
    geometry.scale(w, h, d);
  } else if (solid.shape === "wedge") {
    geometry = wedge(w, h, d);
  } else if (solid.radius && solid.radius > 0.002) {
    const r = Math.min(solid.radius, w / 2, h / 2, d / 2) * 0.999;
    geometry = new RoundedBoxGeometry(w, h, d, 3, r);
  } else geometry = new THREE.BoxGeometry(w, h, d);
  geometry.computeVertexNormals();
  projectUVs(geometry);
  return geometry;
}

export interface LookOptions {
  style: ViewStyle;
  lib: Resolver;
  clipping: THREE.Plane[];
  onTexture: () => void;
}

/** A material of its own for each mesh (so selection can tint it), sharing textures. */
export function materialFor(solid: Solid, look: LookOptions): THREE.Material {
  const glass = !!solid.glass;
  const common = { clippingPlanes: look.clipping, side: solid.shape === "floor" ? THREE.DoubleSide : THREE.FrontSide } as const;
  if (look.style === "lines") {
    return new THREE.MeshBasicMaterial({ ...common, color: glass ? "#eef4f5" : "#ffffff", transparent: glass, opacity: glass ? 0.4 : 1, depthWrite: !glass, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
  }
  if (look.style === "clay") {
    return new THREE.MeshStandardMaterial({ ...common, color: glass ? "#e8eeee" : CLAY, roughness: 0.92, metalness: 0, transparent: glass, opacity: glass ? 0.35 : 1, depthWrite: !glass });
  }
  const def = solid.material ? look.lib.material(solid.material) : undefined;
  const opacity = def?.opacity ?? (glass ? 0.35 : 1);
  const material = new THREE.MeshStandardMaterial({
    ...common,
    color: solid.color,
    roughness: def?.roughness ?? 0.82,
    metalness: def?.metalness ?? 0,
    transparent: opacity < 1,
    opacity,
    depthWrite: opacity >= 0.95,
  });
  if (def) {
    const texture = textureFor(def, look.onTexture);
    if (texture) {
      const tile = (def.tile ?? 1_000) / 1_000;
      // Each mesh scales the shared texture through its own transform.
      const map = texture.clone();
      map.repeat.set(1 / tile, 1 / tile);
      map.needsUpdate = true;
      material.map = map;
      // A colour picked on the item still tints it.
      material.color.set(solid.color === def.color ? "#ffffff" : solid.color);
    }
  }
  return material;
}

/** The fill shown where a section plane cuts through a solid: its inside faces, flat and dark. */
export function cutFill(geometry: THREE.BufferGeometry, clipping: THREE.Plane[], style: ViewStyle): THREE.Mesh {
  const mesh = new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial({ color: style === "lines" ? "#2d3130" : "#545a57", side: THREE.BackSide, clippingPlanes: clipping }),
  );
  mesh.userData.cutFill = true;
  mesh.raycast = () => {};
  return mesh;
}

export function edgesFor(geometry: THREE.BufferGeometry, style: ViewStyle, clipping: THREE.Plane[]): THREE.LineSegments {
  const edge = new THREE.LineSegments(
    new THREE.EdgesGeometry(geometry, 25),
    new THREE.LineBasicMaterial({ color: style === "lines" ? "#1f2322" : "#5e655f", transparent: style !== "lines", opacity: style === "lines" ? 1 : style === "clay" ? 0.35 : 0.2, clippingPlanes: clipping }),
  );
  edge.raycast = () => {};
  return edge;
}

export function disposeObject(root: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>();
  root.traverse((object) => {
    if (object instanceof THREE.Mesh || object instanceof THREE.LineSegments) {
      geometries.add(object.geometry);
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        // Cloned maps belong to this mesh; their image stays with the shared texture.
        (material as THREE.MeshStandardMaterial).map?.dispose();
        material.dispose();
      }
    }
  });
  geometries.forEach((g) => g.dispose());
}
