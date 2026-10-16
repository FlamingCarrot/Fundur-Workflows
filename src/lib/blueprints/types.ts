/**
 * Blueprints: the reusable 3D components the plan is furnished and built with.
 *
 * A blueprint is a small model in its own frame, in millimetres: x runs across
 * its width, y back through its depth (the plan's y), z up. Its origin is the
 * middle of its footprint on the floor. It is made of parts; a part is either a
 * shape (box, cylinder, sphere, wedge, a turned profile or an extruded outline,
 * any of them tapered, hollowed or tilted) or another blueprint, placed, sized
 * and turned inside it. Because a nested part points at the other
 * blueprint by id, changing that blueprint changes every blueprint and every
 * plan that uses it.
 *
 * Wall blueprints (wall types) are a stack of layers across the wall's
 * thickness; walls on a plan can take a type, and so can a blueprint that uses
 * a piece of wall as a part.
 *
 * The defaults that ship with the app have ids starting "std:" and cannot be
 * changed; "Save as new" copies one into the practice's library.
 */

import type { GameAsset } from "@/lib/game-assets/schema";

export type PartShape = "box" | "cylinder" | "sphere" | "wedge" | "lathe" | "extrude" | "mesh";

/**
 * A poly mesh's points, as shares of the part's box (0 to 1 across, back and
 * up), and its faces, each a loop of three or more point numbers going
 * anticlockwise seen from outside.
 */
export interface MeshData {
  v: [number, number, number][];
  f: number[][];
}

/** A point of a profile as shares of the part's size, 0 to 1. */
export type ProfilePoint = [number, number];

export interface Vec3mm {
  x: number;
  y: number;
  z: number;
}

export interface Size3 {
  /** Across, along x. */
  w: number;
  /** Through, along y. */
  d: number;
  /** Up, along z. */
  h: number;
}

export interface Part {
  id: string;
  name?: string;
  /** A simple shape, or another blueprint nested in this one. */
  shape?: PartShape;
  blueprintId?: string;
  /** The middle of the part's footprint (x, y) and its underside (z). */
  at: Vec3mm;
  size: Size3;
  /** Degrees about the vertical, anticlockwise seen from above, about its middle. */
  rotation: number;
  /** Rounds a box's corners (mm). */
  radius?: number;
  /** The top's size as a share of the bottom's, for a box, cylinder or extrusion: 1 is straight, 0 comes to a point. */
  taper?: number;
  /**
   * A lathe's profile turned about its middle: (radius share of half the
   * width, height share) from the bottom up. An extrusion's outline seen from
   * above: (share across, share back).
   */
  profile?: ProfilePoint[];
  /** A cylinder or lathe hollowed to this wall thickness (mm), open at the top with a base as thick: a pot, a tube, a shade. */
  hollow?: number;
  /** Leans the part about its middle (degrees): x tips the top towards the back, y towards the right. */
  tilt?: { x?: number; y?: number };
  /** A material from the library; for a nested blueprint, paints all of it. */
  material?: string;
  /** A poly mesh's own points and faces (shape "mesh"). */
  mesh?: MeshData;
}

export type BlueprintKind = "object" | "wall";

export interface WallLayer {
  name: string;
  thickness: number;
  material: string;
}

export const BLUEPRINT_CATEGORIES = [
  "Work",
  "Meeting",
  "Lounge",
  "Dining",
  "Kitchen",
  "Bathroom",
  "Bedroom",
  "Storage",
  "Lighting",
  "Decor",
  "Walls",
  "Building",
  "Other",
  "Props",
  "Characters",
  "Creatures",
  "Vehicles",
  "Weapons",
  "Environment",
] as const;
export type BlueprintCategory = (typeof BLUEPRINT_CATEGORIES)[number];

export interface Blueprint {
  id: string;
  name: string;
  kind: BlueprintKind;
  category: BlueprintCategory;
  /**
   * What it counts as for layout rules and the plan symbol (a furniture
   * library type such as "desk"), so a custom desk is still a desk.
   */
  type: string;
  /** Its nominal size; instances on a plan are stretched from this. */
  size: Size3;
  parts: Part[];
  /** Wall types only: from the wall's left face (going start to end) to its right. */
  layers?: WallLayer[];
  /** How it is drawn on the 2D plan: the library symbol of its type, or outlines of its parts seen from above. */
  symbol: "type" | "parts";
  description?: string;
  tags?: string[];
  /** The blueprint it was saved from. */
  basedOn?: string;
  gameAsset?: GameAsset;
  revision: number;
  updatedAt?: string;
  updatedBy?: string;
  createdBy?: string;
}

export type MaterialPattern =
  | "plain"
  | "wood"
  | "planks"
  | "tiles"
  | "brick"
  | "concrete"
  | "marble"
  | "fabric"
  | "carpet"
  | "metal"
  | "terrazzo"
  | "herringbone";

export const MATERIAL_CATEGORIES = ["Wood", "Stone", "Tile", "Concrete", "Paint", "Fabric", "Metal", "Glass", "Plastic", "Other"] as const;
export type MaterialCategory = (typeof MATERIAL_CATEGORIES)[number];

export interface MaterialSource {
  /** "Poly Haven", "AI", "Upload". */
  name: string;
  url?: string;
  licence?: string;
}

export interface Material {
  id: string;
  name: string;
  category: MaterialCategory;
  /** Base colour, "#rrggbb". */
  color: string;
  roughness: number;
  metalness: number;
  /** 1 is solid; glass is around 0.3. */
  opacity?: number;
  /** A pattern drawn in the browser, so it needs no download. */
  pattern?: MaterialPattern;
  /** An image texture (an https address or a small data URL), tiled. */
  image?: string;
  /** The real size one repeat of the texture covers, in mm. */
  tile?: number;
  source?: MaterialSource;
  revision: number;
  updatedAt?: string;
  createdBy?: string;
}

export interface Library {
  blueprints: Blueprint[];
  materials: Material[];
}

export const isStandard = (id: string) => id.startsWith("std:");
