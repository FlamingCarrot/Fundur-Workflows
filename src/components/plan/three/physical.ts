import * as THREE from "three";
import type { Material } from "@/lib/blueprints/types";

/** Existing materials keep the inexpensive standard shader unless an advanced finish is enabled. */
export function finishMaterial(def: Material | undefined, parameters: THREE.MeshStandardMaterialParameters): THREE.MeshStandardMaterial {
  if (!def || ![def.clearcoat, def.sheen, def.transmission, def.iridescence, def.subsurface].some(value => (value ?? 0) > 0) && (def.ior == null || def.ior === 1.5)) return new THREE.MeshStandardMaterial(parameters);
  const material = new THREE.MeshPhysicalMaterial({ ...parameters,
    clearcoat: def.clearcoat ?? 0, clearcoatRoughness: def.clearcoatRoughness ?? .1,
    sheen: def.sheen ?? 0, sheenColor: def.sheenColor ?? "#ffffff", sheenRoughness: .7,
    transmission: def.transmission ?? 0, ior: def.ior ?? 1.5,
    thickness: (def.thickness ?? 1) / 1000,
    attenuationColor: def.attenuationColor ?? "#ffffff",
    attenuationDistance: def.attenuationDistance == null ? Infinity : def.attenuationDistance / 1000,
    iridescence: def.iridescence ?? 0,
  });
  if ((def.subsurface ?? 0) > 0) {
    // Direct-light translucency approximation, following the approach demonstrated
    // in Three.js' SubsurfaceScatteringShader. No claim of measured thickness or
    // multiple scattering; these settings are explicitly preview-only on export.
    material.onBeforeCompile = shader => {
      shader.uniforms.fundurScatter = { value: def.subsurface };
      shader.uniforms.fundurScatterColor = { value: new THREE.Color(def.subsurfaceColor ?? "#ffb08a") };
      shader.uniforms.fundurScatterRadius = { value: def.subsurfaceRadius ?? 3 };
      shader.uniforms.fundurThickness = { value: def.thickness ?? 1 };
      const direct = "RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );";
      const lighting = THREE.ShaderChunk.lights_fragment_begin.split(direct).join(`${direct}\nreflectedLight.directDiffuse += fundurScattering( directLight, geometryNormal, geometryViewDir );`);
      shader.fragmentShader = shader.fragmentShader.replace("#include <lights_physical_pars_fragment>", `#include <lights_physical_pars_fragment>
uniform float fundurScatter;
uniform vec3 fundurScatterColor;
uniform float fundurScatterRadius;
uniform float fundurThickness;
vec3 fundurScattering( const in IncidentLight source, const in vec3 surfaceNormal, const in vec3 viewDirection ) {
  vec3 bentLight = normalize( source.direction + surfaceNormal * 0.2 );
  float backLight = pow( max( dot( viewDirection, -bentLight ), 0.0 ), 2.0 );
  vec3 travel = exp( -vec3( fundurThickness ) / max( fundurScatterColor * fundurScatterRadius, vec3( 0.001 ) ) );
  return source.color * travel * backLight * fundurScatter * 0.5;
}` ).replace("#include <lights_fragment_begin>", lighting);
    };
    material.customProgramCacheKey = () => "fundur-fast-subsurface-v1";
  }
  return material;
}
