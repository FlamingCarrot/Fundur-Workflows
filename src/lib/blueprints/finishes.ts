import type { Material } from "./types";

type Finish = Partial<Omit<Material, "id" | "name" | "revision">>;
const reset: Finish = { pattern: "plain", opacity: 1, metalness: 0, clearcoat: 0, clearcoatRoughness: .1,
  sheen: 0, sheenColor: "#ffffff", transmission: 0, ior: 1.5, thickness: 1,
  attenuationColor: "#ffffff", attenuationDistance: 100, iridescence: 0, subsurface: 0,
  subsurfaceColor: "#ffb08a", subsurfaceRadius: 3, image: undefined, source: undefined };

/** Art-direction starting points, not measured optical properties. */
export const FINISH_PRESETS: { key: string; label: string; body: Finish }[] = [
  { key: "matte", label: "Matte", body: { ...reset, color: "#c9c3b8", roughness: .85 } },
  { key: "lacquer", label: "Lacquer", body: { ...reset, color: "#72352d", roughness: .3, clearcoat: 1, clearcoatRoughness: .1 } },
  { key: "metal", label: "Metal", body: { ...reset, color: "#bfc7cc", roughness: .2, metalness: 1, category: "Metal" } },
  { key: "glass", label: "Glass", body: { ...reset, color: "#f4fcff", roughness: .05, transmission: .95, thickness: 5, attenuationColor: "#d9f2ed", attenuationDistance: 100, category: "Glass" } },
  { key: "fabric", label: "Fabric", body: { ...reset, color: "#555f75", roughness: .85, sheen: .8, sheenColor: "#a1b1ce", category: "Fabric" } },
  { key: "skin", label: "Skin · SSS", body: { ...reset, color: "#d8a18b", roughness: .55, subsurface: .65, subsurfaceColor: "#ff7850", subsurfaceRadius: 3, thickness: 1 } },
  { key: "wax", label: "Wax · SSS", body: { ...reset, color: "#eddbb1", roughness: .4, subsurface: .8, subsurfaceColor: "#ffd48e", subsurfaceRadius: 15, thickness: 5 } },
  { key: "jade", label: "Jade · SSS", body: { ...reset, color: "#6d9c7d", roughness: .25, clearcoat: .4, subsurface: .7, subsurfaceColor: "#8de5b0", subsurfaceRadius: 20, thickness: 8 } },
];
