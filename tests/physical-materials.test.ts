import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { FINISH_PRESETS } from "../src/lib/blueprints/finishes";
import { materialBody } from "../src/lib/blueprints/schema";
import type { Material } from "../src/lib/blueprints/types";
import { finishMaterial } from "../src/components/plan/three/physical";
import { blankBlueprint } from "../src/lib/blueprints/edit";
import { resolver } from "../src/lib/blueprints/resolve";
import { exportGameGLTF } from "../src/lib/game-assets/export";

const preset = (key: string): Material => ({ name: key, category: "Other", color: "#c9c3b8", roughness: .8, metalness: 0, ...FINISH_PRESETS.find(p => p.key === key)!.body, id: key, revision: 1 });

test("physical finish presets validate and old materials retain the standard renderer", () => {
  for (const p of FINISH_PRESETS) assert.ok(materialBody.safeParse(preset(p.key)).success, p.key);
  assert.equal(finishMaterial(undefined, {}).type, "MeshStandardMaterial");
  assert.equal(finishMaterial(preset("matte"), {}).type, "MeshStandardMaterial");
  const glass = finishMaterial(preset("glass"), {}) as THREE.MeshPhysicalMaterial;
  assert.equal(glass.type, "MeshPhysicalMaterial");
  assert.equal(glass.transmission, .95);
  assert.equal(glass.thickness, .005);
  assert.equal(glass.attenuationDistance, .1);
  assert.equal(materialBody.safeParse({ ...preset("glass"), subsurfaceRadius: 0 }).success, false);
  assert.equal(materialBody.safeParse({ ...preset("glass"), ior: 8 }).success, false);
});

test("fast SSS hooks the installed physical shader's direct lights and supplies bounded uniforms", () => {
  const mat = finishMaterial(preset("skin"), {});
  const shader = { uniforms: THREE.UniformsUtils.clone(THREE.ShaderLib.physical.uniforms), vertexShader: THREE.ShaderLib.physical.vertexShader, fragmentShader: THREE.ShaderLib.physical.fragmentShader };
  mat.onBeforeCompile(shader as Parameters<typeof mat.onBeforeCompile>[0], {} as THREE.WebGLRenderer);
  assert.match(shader.fragmentShader, /vec3 fundurScattering/);
  assert.match(shader.fragmentShader, /directDiffuse \+= fundurScattering/);
  assert.equal(shader.uniforms.fundurScatter.value, .65);
  assert.equal(shader.uniforms.fundurScatterRadius.value, 3);
  assert.equal(shader.uniforms.fundurThickness.value, 1);
  assert.equal(mat.customProgramCacheKey(), "fundur-fast-subsurface-v1");
});

test("advanced material export uses glTF physical extensions and identifies SSS as preview metadata", () => {
  for (const key of ["glass", "skin", "jade", "fabric", "lacquer"]) {
    const mat = preset(key);
    const bp = { ...blankBlueprint(key), id: key, revision: 1 };
    bp.parts[0].material = key;
    const gltf = JSON.parse(exportGameGLTF(resolver({ materials: [mat] }), bp));
    if (key === "glass") {
      assert.ok(gltf.extensionsUsed.includes("KHR_materials_transmission"));
      assert.equal(gltf.materials[0].extensions.KHR_materials_volume.thicknessFactor, .005);
    }
    if (mat.subsurface) assert.equal(gltf.materials[0].extras.fundurSubsurface.previewOnly, true);
    if (key === "fabric") assert.ok(gltf.extensionsUsed.includes("KHR_materials_sheen"));
    if (key === "lacquer") assert.ok(gltf.extensionsUsed.includes("KHR_materials_clearcoat"));
  }
});
