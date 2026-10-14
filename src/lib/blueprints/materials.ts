import type { Material, MaterialCategory, MaterialPattern } from "./types";

/**
 * The materials that ship with the app. Their textures are drawn in the
 * browser from a pattern, so they work offline and carry no licence. The
 * practice adds its own: a colour, a free texture from an open library, or a
 * texture the AI makes.
 */

const m = (
  id: string,
  name: string,
  category: MaterialCategory,
  color: string,
  pattern: MaterialPattern = "plain",
  extra: Partial<Material> = {},
): Material => ({
  id: `std:${id}`,
  name,
  category,
  color,
  pattern,
  roughness: extra.roughness ?? 0.8,
  metalness: extra.metalness ?? 0,
  revision: 1,
  ...extra,
});

export const STANDARD_MATERIALS: Material[] = [
  m("white-paint", "White paint", "Paint", "#efede6", "plain", { roughness: 0.9 }),
  m("warm-grey-paint", "Warm grey paint", "Paint", "#c9c3b8", "plain", { roughness: 0.9 }),
  m("sage-paint", "Sage paint", "Paint", "#a9b5a0", "plain", { roughness: 0.9 }),
  m("charcoal-paint", "Charcoal paint", "Paint", "#3f4241", "plain", { roughness: 0.85 }),
  m("terracotta-paint", "Terracotta paint", "Paint", "#b8735a", "plain", { roughness: 0.9 }),
  m("oak", "Oak", "Wood", "#c49a6c", "wood", { roughness: 0.65, tile: 1_200 }),
  m("walnut", "Walnut", "Wood", "#6f4a33", "wood", { roughness: 0.6, tile: 1_200 }),
  m("ash", "Pale ash", "Wood", "#dcc7a5", "wood", { roughness: 0.65, tile: 1_200 }),
  m("oak-planks", "Oak floorboards", "Wood", "#b88c5e", "planks", { roughness: 0.6, tile: 1_800 }),
  m("herringbone", "Herringbone parquet", "Wood", "#b8875a", "herringbone", { roughness: 0.6, tile: 1_000 }),
  m("plywood", "Birch plywood", "Wood", "#e1c9a0", "wood", { roughness: 0.7, tile: 1_200 }),
  m("marble", "White marble", "Stone", "#ece9e3", "marble", { roughness: 0.25, tile: 1_600 }),
  m("terrazzo", "Terrazzo", "Stone", "#dedad2", "terrazzo", { roughness: 0.35, tile: 800 }),
  m("granite", "Dark granite", "Stone", "#4a4a4c", "terrazzo", { roughness: 0.3, tile: 600 }),
  m("tiles-white", "White tiles 300", "Tile", "#f2f1ee", "tiles", { roughness: 0.3, tile: 300 }),
  m("tiles-grey", "Grey tiles 600", "Tile", "#9c9a95", "tiles", { roughness: 0.45, tile: 600 }),
  m("brick", "Face brick", "Stone", "#a2583e", "brick", { roughness: 0.9, tile: 450 }),
  m("concrete", "Concrete", "Concrete", "#a7a6a1", "concrete", { roughness: 0.92, tile: 1_500 }),
  m("polished-concrete", "Polished concrete", "Concrete", "#b9b7b1", "concrete", { roughness: 0.4, tile: 2_000 }),
  m("plaster", "Plaster", "Paint", "#e7e2d8", "concrete", { roughness: 0.95, tile: 2_000 }),
  m("linen", "Linen", "Fabric", "#d8cfbf", "fabric", { roughness: 1, tile: 200 }),
  m("boucle", "Bouclé", "Fabric", "#ebe5d9", "fabric", { roughness: 1, tile: 150 }),
  m("velvet-green", "Green velvet", "Fabric", "#4f6b55", "fabric", { roughness: 0.9, tile: 200 }),
  m("felt-grey", "Grey felt", "Fabric", "#8e908c", "fabric", { roughness: 1, tile: 200 }),
  m("leather", "Tan leather", "Fabric", "#9c6b45", "plain", { roughness: 0.55 }),
  m("carpet", "Carpet tile", "Fabric", "#7d817d", "carpet", { roughness: 1, tile: 500 }),
  m("steel", "Brushed steel", "Metal", "#b6b8b8", "metal", { roughness: 0.35, metalness: 0.9, tile: 600 }),
  m("black-steel", "Black steel", "Metal", "#2d2f30", "plain", { roughness: 0.45, metalness: 0.7 }),
  m("brass", "Brass", "Metal", "#b8955a", "metal", { roughness: 0.3, metalness: 0.95, tile: 600 }),
  m("chrome", "Chrome", "Metal", "#d9dcdd", "plain", { roughness: 0.1, metalness: 1 }),
  m("glass", "Clear glass", "Glass", "#bcd8dc", "plain", { roughness: 0.05, opacity: 0.3 }),
  m("frosted-glass", "Frosted glass", "Glass", "#dfe9ea", "plain", { roughness: 0.4, opacity: 0.6 }),
  m("white-laminate", "White laminate", "Plastic", "#f4f3ef", "plain", { roughness: 0.5 }),
  m("ceramic", "White ceramic", "Plastic", "#f7f7f4", "plain", { roughness: 0.15 }),
  m("rubber", "Black rubber", "Plastic", "#2a2a2a", "plain", { roughness: 0.95 }),
  m("plant", "Foliage", "Other", "#5e7f4b", "fabric", { roughness: 0.9, tile: 300 }),
  m("plant-deep", "Foliage, deep gloss", "Other", "#36562f", "plain", { roughness: 0.45 }),
  m("soil", "Soil", "Other", "#4d3a2c", "concrete", { roughness: 1, tile: 300 }),
  m("mattress", "Bed linen", "Fabric", "#f1efe9", "fabric", { roughness: 1, tile: 300 }),
  m("screen", "Screen", "Plastic", "#1d2125", "plain", { roughness: 0.2 }),
];

const BY_ID = new Map(STANDARD_MATERIALS.map((x) => [x.id, x]));

export function standardMaterial(id: string): Material | undefined {
  return BY_ID.get(id);
}

/** The colour any material shows in the gray model and in plain previews. */
export const CLAY = "#d9d8d3";
