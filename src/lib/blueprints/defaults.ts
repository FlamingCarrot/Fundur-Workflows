import { LIBRARY, type Category } from "@/lib/plan/library";
import { growPlant } from "./plants";
import type { Blueprint, BlueprintCategory, Part, PartShape, WallLayer } from "./types";

/**
 * The blueprints that ship with the app: one for every furniture type the plan
 * library has (so every item already on a plan has a proper 3D model), the
 * common wall types, and a few nested assemblies that show how blueprints are
 * built from blueprints. They are read-only; "Save as new" copies one.
 *
 * Sizes are millimetres in the blueprint's own frame: x across, y back (the
 * back of a chair is +y), z up, origin at the middle of the footprint.
 */

let counter = 0;
function p(
  name: string,
  shape: PartShape,
  x: number,
  y: number,
  z: number,
  w: number,
  d: number,
  h: number,
  material: string,
  extra: Partial<Part> = {},
): Part {
  counter += 1;
  return { id: `p${counter}`, name, shape, at: { x, y, z }, size: { w, d, h }, rotation: 0, material: `std:${material}`, ...extra };
}
function nest(name: string, blueprintId: string, x: number, y: number, z: number, w: number, d: number, h: number, rotation = 0): Part {
  counter += 1;
  return { id: `p${counter}`, name, blueprintId, at: { x, y, z }, size: { w, d, h }, rotation };
}

/** Four legs inset from the corners of a w × d top. */
function legs(w: number, d: number, h: number, size: number, inset: number, material = "black-steel", round = false): Part[] {
  const out: Part[] = [];
  for (const sx of [-1, 1])
    for (const sy of [-1, 1])
      out.push(p("Leg", round ? "cylinder" : "box", sx * (w / 2 - inset), sy * (d / 2 - inset), 0, size, size, h, material));
  return out;
}

const CATEGORY: Record<Category, BlueprintCategory> = {
  Work: "Work",
  Meeting: "Meeting",
  Lounge: "Lounge",
  Kitchen: "Kitchen",
  Bathroom: "Bathroom",
  Storage: "Storage",
  Other: "Other",
};

/** Parts for each library type at its nominal size. */
const BUILDERS: Record<string, (w: number, d: number, h: number) => Part[]> = {
  desk: (w, d, h) => [p("Top", "box", 0, 0, h - 25, w, d, 25, "oak"), p("Left frame", "box", -w / 2 + 40, 0, 0, 50, d - 80, h - 25, "black-steel"), p("Right frame", "box", w / 2 - 40, 0, 0, 50, d - 80, h - 25, "black-steel"), p("Modesty panel", "box", 0, d / 2 - 60, 300, w - 160, 18, h - 340, "felt-grey")],
  "desk-chair": () => [nest("Desk", "std:desk", 0, 300, 0, 1_600, 800, 730), nest("Chair", "std:office-chair", 0, -450, 0, 600, 600, 1_000, 180)],
  "desk-l": (w, d, h) => [p("Main top", "box", 0, d / 2 - 400, h - 25, w, 800, 25, "oak"), p("Return top", "box", -w / 2 + 400, -400, h - 25, 800, d - 800, 25, "oak"), p("Frame", "box", w / 2 - 40, d / 2 - 400, 0, 50, 720, h - 25, "black-steel"), p("Frame", "box", -w / 2 + 400, -d / 2 + 40, 0, 720, 50, h - 25, "black-steel"), p("Corner leg", "cylinder", -w / 2 + 60, d / 2 - 60, 0, 60, 60, h - 25, "black-steel")],
  "office-chair": (w, d, h) => [p("Base", "cylinder", 0, 0, 0, w * 0.95, d * 0.95, 60, "rubber"), p("Column", "cylinder", 0, 0, 60, 60, 60, 360, "chrome"), p("Seat", "box", 0, -30, 420, w * 0.8, d * 0.75, 70, "felt-grey", { radius: 60 }), p("Back", "box", 0, d * 0.36, 520, w * 0.75, 60, h - 540, "felt-grey", { radius: 50 }), p("Arm", "box", -w * 0.42, 0, 560, 50, d * 0.45, 40, "rubber"), p("Arm", "box", w * 0.42, 0, 560, 50, d * 0.45, 40, "rubber")],
  reception: (w, d, h) => [p("Counter", "box", 0, -d / 2 + 150, 0, w, 300, h, "oak"), p("Desk", "box", 0, 100, 0, w, d - 300, 730, "white-laminate"), p("Transaction top", "box", 0, -d / 2 + 150, h, w, 320, 25, "marble")],
  printer: (w, d, h) => [p("Body", "box", 0, 0, 0, w, d, h - 150, "white-laminate", { radius: 30 }), p("Scanner", "box", 0, 0, h - 150, w * 0.9, d * 0.85, 150, "charcoal-paint", { radius: 20 })],
  "meeting-table": (w, d, h) => {
    const seats = Math.max(1, Math.floor(w / 700));
    const chairs: Part[] = [];
    for (let i = 0; i < seats; i++) {
      const x = -w / 2 + ((i + 0.5) * w) / seats;
      chairs.push(nest("Chair", "std:chair", x, d / 2 + 250, 0, 450, 450, 850, 0), nest("Chair", "std:chair", x, -d / 2 - 250, 0, 450, 450, 850, 180));
    }
    return [p("Top", "box", 0, 0, h - 30, w, d, 30, "walnut", { radius: 60 }), p("Pedestal", "box", -w / 4, 0, 0, 120, d * 0.5, h - 30, "black-steel"), p("Pedestal", "box", w / 4, 0, 0, 120, d * 0.5, h - 30, "black-steel"), ...chairs];
  },
  "round-table": (w, d, h) => [p("Top", "cylinder", 0, 0, h - 30, w, d, 30, "ash"), p("Column", "cylinder", 0, 0, 30, 90, 90, h - 60, "black-steel"), p("Foot", "cylinder", 0, 0, 0, w * 0.5, d * 0.5, 30, "black-steel")],
  chair: (w, d, h) => [...legs(w * 0.9, d * 0.9, 450, 30, 30, "oak", true), p("Seat", "box", 0, 0, 430, w, d * 0.9, 40, "oak", { radius: 30 }), p("Back", "box", 0, d * 0.4, 470, w, 30, h - 470, "oak", { radius: 20 })],
  screen: (w, d, h) => [p("Screen", "box", 0, 0, 900, w, d, h, "screen")],
  whiteboard: (w, d, h) => [p("Board", "box", 0, 0, 900, w, d, h, "white-laminate"), p("Tray", "box", 0, -d, 880, w * 0.8, 60, 20, "steel")],
  sofa: (w, d, h) => [p("Base", "box", 0, 0, 80, w, d, 330, "linen", { radius: 60 }), p("Back", "box", 0, d / 2 - 110, 410, w - 300, 220, h - 410, "linen", { radius: 80 }), p("Arm", "box", -w / 2 + 90, 0, 410, 180, d, 200, "linen", { radius: 80 }), p("Arm", "box", w / 2 - 90, 0, 410, 180, d, 200, "linen", { radius: 80 }), p("Cushion", "box", -(w - 360) / 4, -60, 410, (w - 380) / 2, d - 300, 110, "linen", { radius: 60 }), p("Cushion", "box", (w - 360) / 4, -60, 410, (w - 380) / 2, d - 300, 110, "linen", { radius: 60 }), ...legs(w - 100, d - 100, 80, 40, 30, "walnut", true)],
  armchair: (w, d, h) => [p("Base", "box", 0, 0, 80, w, d, 330, "boucle", { radius: 80 }), p("Back", "box", 0, d / 2 - 100, 410, w - 260, 200, h - 410, "boucle", { radius: 80 }), p("Arm", "box", -w / 2 + 75, 0, 410, 150, d, 200, "boucle", { radius: 70 }), p("Arm", "box", w / 2 - 75, 0, 410, 150, d, 200, "boucle", { radius: 70 }), p("Cushion", "box", 0, -50, 410, w - 320, d - 260, 100, "boucle", { radius: 60 }), ...legs(w - 100, d - 100, 80, 40, 30, "walnut", true)],
  "coffee-table": (w, d, h) => [p("Top", "box", 0, 0, h - 30, w, d, 30, "walnut", { radius: 40 }), ...legs(w, d, h - 30, 40, 60, "walnut", true)],
  "side-table": (w, d, h) => [p("Top", "cylinder", 0, 0, h - 25, w, d, 25, "marble"), p("Stem", "cylinder", 0, 0, 0, 50, 50, h - 25, "brass"), p("Foot", "cylinder", 0, 0, 0, w * 0.6, d * 0.6, 15, "brass")],
  plant: (w, d, h) => [
    p("Pot", "cylinder", 0, 0, 0, w * 0.6, d * 0.6, h * 0.3, "terracotta-paint", { taper: 1.15, hollow: 12 }),
    p("Soil", "cylinder", 0, 0, h * 0.3 - 40, w * 0.6, d * 0.6, 20, "soil"),
    // A real-looking plant: trunk, branches and individual leaves, the same every time.
    ...growPlant({ base: { x: 0, y: 0, z: h * 0.3 - 20 }, height: h * 0.7, spread: Math.min(w, d), style: "tree", leaf: "ovate", leaves: 70, leafLength: Math.max(80, h * 0.12), branches: 6, trunkMaterial: "std:walnut", leafMaterials: ["std:plant", "std:plant-deep"], seed: 11 }).map((g) => p(g.name ?? "Leaf", g.shape!, g.at.x, g.at.y, g.at.z, g.size.w, g.size.d, g.size.h, (g.material ?? "std:plant").replace(/^std:/, ""), { rotation: g.rotation, ...(g.tilt ? { tilt: g.tilt } : {}), ...(g.profile ? { profile: g.profile } : {}), ...(g.taper != null ? { taper: g.taper } : {}) })),
  ],
  rug: (w, d, h) => [p("Rug", "box", 0, 0, 0, w, d, h, "carpet")],
  counter: (w, d, h) => [p("Base", "box", 0, 20, 100, w, d - 40, h - 130, "white-laminate"), p("Kick", "box", 0, 40, 0, w, d - 80, 100, "charcoal-paint"), p("Worktop", "box", 0, 0, h - 30, w, d, 30, "terrazzo")],
  "kitchen-sink": (w, d, h) => [p("Base", "box", 0, 20, 100, w, d - 40, h - 130, "white-laminate"), p("Kick", "box", 0, 40, 0, w, d - 80, 100, "charcoal-paint"), p("Worktop", "box", 0, 0, h - 30, w, d, 30, "terrazzo"), p("Bowl", "box", -w / 4 + 25, 0, h - 28, w / 2 - 50, d - 180, 4, "steel", { radius: 40 }), p("Tap", "cylinder", w / 4, d / 4, h, 40, 40, 250, "chrome")],
  hob: (w, d, h) => [p("Base", "box", 0, 20, 100, w, d - 40, h - 130, "white-laminate"), p("Kick", "box", 0, 40, 0, w, d - 80, 100, "charcoal-paint"), p("Worktop", "box", 0, 0, h - 30, w, d, 30, "terrazzo"), p("Glass top", "box", 0, 0, h, w - 60, d - 60, 6, "screen")],
  fridge: (w, d, h) => [p("Body", "box", 0, 0, 0, w, d, h, "steel", { radius: 15 }), p("Handle", "box", w / 2 - 60, -d / 2 - 15, h * 0.45, 25, 30, h * 0.4, "chrome")],
  dishwasher: (w, d, h) => [p("Body", "box", 0, 0, 0, w, d, h, "steel"), p("Handle", "box", 0, -d / 2 - 12, h - 120, w * 0.6, 25, 25, "chrome")],
  island: (w, d, h) => [p("Base", "box", 0, 0, 100, w - 60, d - 60, h - 130, "walnut"), p("Kick", "box", 0, 0, 0, w - 120, d - 120, 100, "charcoal-paint"), p("Worktop", "box", 0, 0, h - 30, w, d, 30, "marble")],
  wc: (w, d, h) => [p("Cistern", "box", 0, d / 2 - 90, 0, w, 180, h, "ceramic", { radius: 30 }), p("Bowl", "cylinder", 0, -60, 0, w - 40, d - 200, 400, "ceramic"), p("Seat", "cylinder", 0, -60, 400, w - 30, d - 190, 25, "ceramic")],
  basin: (w, d, h) => [p("Basin", "box", 0, 0, h - 150, w, d, 150, "ceramic", { radius: 60 }), p("Tap", "cylinder", 0, d / 2 - 60, h, 35, 35, 180, "chrome"), p("Waste", "cylinder", 0, d / 2 - 100, 0, 60, 60, h - 150, "chrome")],
  shower: (w, d, h) => [p("Tray", "box", 0, 0, 0, w, d, 40, "ceramic"), p("Screen", "box", 0, -d / 2 + 5, 40, w, 10, h - 40, "glass"), p("Screen", "box", -w / 2 + 5, 0, 40, 10, d, h - 40, "glass"), p("Rose", "cylinder", 0, d / 2 - 150, h - 150, 220, 220, 20, "chrome")],
  bath: (w, d, h) => [p("Bath", "box", 0, 0, 0, w, d, h, "ceramic", { radius: 120 }), p("Tap", "cylinder", -w / 2 + 120, 0, h, 40, 40, 160, "chrome")],
  urinal: (w, d, h) => [p("Urinal", "box", 0, 0, 500, w, d, h, "ceramic", { radius: 120 })],
  cupboard: (w, d, h) => [p("Carcass", "box", 0, 0, 0, w, d, h, "white-laminate"), p("Door", "box", -w / 4, -d / 2 - 9, 20, w / 2 - 6, 18, h - 40, "oak"), p("Door", "box", w / 4, -d / 2 - 9, 20, w / 2 - 6, 18, h - 40, "oak")],
  shelving: (w, d, h) => {
    const shelves = Math.max(2, Math.round(h / 380));
    return [p("Side", "box", -w / 2 + 12, 0, 0, 25, d, h, "oak"), p("Side", "box", w / 2 - 12, 0, 0, 25, d, h, "oak"), ...Array.from({ length: shelves + 1 }, (_, i) => p("Shelf", "box", 0, 0, (i * (h - 25)) / shelves, w - 50, d, 25, "oak"))];
  },
  filing: (w, d, h) => [p("Body", "box", 0, 0, 0, w, d, h, "warm-grey-paint"), ...Array.from({ length: 4 }, (_, i) => p("Drawer front", "box", 0, -d / 2 - 5, 20 + (i * (h - 40)) / 4, w - 30, 10, (h - 40) / 4 - 20, "warm-grey-paint"))],
  lockers: (w, d, h) => {
    const n = Math.max(1, Math.round(w / 400));
    return [p("Carcass", "box", 0, 0, 0, w, d, h, "warm-grey-paint"), ...Array.from({ length: n }, (_, i) => p("Door", "box", -w / 2 + ((i + 0.5) * w) / n, -d / 2 - 5, 20, w / n - 10, 10, h - 40, "sage-paint"))];
  },
  "bed-double": (w, d) => [p("Base", "box", 0, 0, 100, w, d, 250, "linen"), p("Mattress", "box", 0, -40, 350, w - 40, d - 120, 200, "mattress", { radius: 40 }), p("Headboard", "box", 0, d / 2 - 40, 100, w + 40, 80, 1_000, "linen", { radius: 40 }), p("Pillow", "box", -w / 4, d / 2 - 300, 550, w / 2 - 120, 350, 120, "mattress", { radius: 60 }), p("Pillow", "box", w / 4, d / 2 - 300, 550, w / 2 - 120, 350, 120, "mattress", { radius: 60 }), ...legs(w - 80, d - 80, 100, 50, 40, "walnut")],
  stair: (w, d, h) => {
    const steps = Math.max(2, Math.round(d / 280));
    return Array.from({ length: steps }, (_, i) => p("Tread", "box", 0, -d / 2 + ((i + 0.5) * d) / steps, 0, w, d / steps, ((i + 1) * h) / steps, "oak"));
  },
  box: (w, d, h) => [p("Box", "box", 0, 0, 0, w, d, h, "warm-grey-paint")],
};

/** Each default material layer stack, from the left face to the right. */
const WALLS: { id: string; name: string; layers: WallLayer[]; description: string }[] = [
  { id: "wall-drywall-100", name: "Drywall partition 100", description: "Two boards each side of a 76 mm steel stud, painted.", layers: [{ name: "Board", thickness: 12, material: "std:white-paint" }, { name: "Stud and insulation", thickness: 76, material: "std:plaster" }, { name: "Board", thickness: 12, material: "std:white-paint" }] },
  { id: "wall-block-140", name: "Block wall 140, plastered", description: "140 mm masonry block, 15 mm plaster each side.", layers: [{ name: "Plaster", thickness: 15, material: "std:white-paint" }, { name: "Block", thickness: 140, material: "std:concrete" }, { name: "Plaster", thickness: 15, material: "std:white-paint" }] },
  { id: "wall-brick-230", name: "Brick wall 230, face brick out", description: "Two skins of brick, face brick on the right face, plastered on the left.", layers: [{ name: "Plaster", thickness: 15, material: "std:white-paint" }, { name: "Brick", thickness: 215, material: "std:brick" }] },
  { id: "wall-concrete-200", name: "Concrete wall 200", description: "Off-shutter concrete.", layers: [{ name: "Concrete", thickness: 200, material: "std:concrete" }] },
  { id: "wall-glass-partition", name: "Glazed partition", description: "Frameless glass on a slim floor channel.", layers: [{ name: "Glass", thickness: 12, material: "std:glass" }] },
  { id: "wall-acoustic-150", name: "Acoustic partition 150, felt finish", description: "Double stud with insulation, felt panels on the left face.", layers: [{ name: "Felt panel", thickness: 12, material: "std:felt-grey" }, { name: "Board", thickness: 25, material: "std:plaster" }, { name: "Studs and insulation", thickness: 88, material: "std:plaster" }, { name: "Board", thickness: 25, material: "std:white-paint" }] },
];

/** A wall type's parts: one slab per layer, across a nominal piece of wall. */
export function wallParts(layers: WallLayer[], w: number, h: number): Part[] {
  const total = layers.reduce((s, l) => s + l.thickness, 0);
  let y = total / 2;
  return layers.map((l, i) => {
    const part: Part = { id: `layer-${i}`, name: l.name, shape: "box", at: { x: 0, y: y - l.thickness / 2, z: 0 }, size: { w, d: l.thickness, h }, rotation: 0, material: l.material };
    y -= l.thickness;
    return part;
  });
}

export const wallThickness = (layers: WallLayer[]) => layers.reduce((s, l) => s + l.thickness, 0);

function build(): Blueprint[] {
  const out: Blueprint[] = [];
  for (const item of LIBRARY) {
    const builder = BUILDERS[item.type] ?? BUILDERS.box;
    counter = 0;
    out.push({
      id: `std:${item.type}`,
      name: item.name,
      kind: "object",
      category: item.type === "bed-double" ? "Bedroom" : item.type === "stair" ? "Building" : CATEGORY[item.category],
      type: item.type,
      size: { w: item.width, d: item.depth, h: item.height },
      parts: builder(item.width, item.depth, item.height),
      symbol: "type",
      revision: 1,
    });
  }
  for (const wall of WALLS) {
    const d = wallThickness(wall.layers);
    out.push({
      id: `std:${wall.id}`,
      name: wall.name,
      kind: "wall",
      category: "Walls",
      type: "box",
      size: { w: 1_000, d, h: 2_700 },
      parts: wallParts(wall.layers, 1_000, 2_700),
      layers: wall.layers,
      symbol: "parts",
      description: wall.description,
      revision: 1,
    });
  }
  // Assemblies made of other blueprints: change the desk and every workstation follows.
  counter = 0;
  out.push(
    {
      id: "std:workstation-bench-4",
      name: "Bench of four desks",
      kind: "object",
      category: "Work",
      type: "desk",
      size: { w: 3_200, d: 2_800, h: 1_200 },
      parts: [
        nest("Desk", "std:desk", -800, 400, 0, 1_600, 800, 730, 180),
        nest("Desk", "std:desk", 800, 400, 0, 1_600, 800, 730, 180),
        nest("Desk", "std:desk", -800, -400, 0, 1_600, 800, 730),
        nest("Desk", "std:desk", 800, -400, 0, 1_600, 800, 730),
        nest("Chair", "std:office-chair", -800, 1_100, 0, 600, 600, 1_000),
        nest("Chair", "std:office-chair", 800, 1_100, 0, 600, 600, 1_000),
        nest("Chair", "std:office-chair", -800, -1_100, 0, 600, 600, 1_000, 180),
        nest("Chair", "std:office-chair", 800, -1_100, 0, 600, 600, 1_000, 180),
        p("Screen", "box", 0, 0, 730, 3_200, 25, 450, "felt-grey"),
      ],
      symbol: "parts",
      description: "Four desks facing in pairs with a felt screen. Built from the Desk and Office chair blueprints.",
      revision: 1,
    },
    {
      id: "std:dining-set-4",
      name: "Dining table with four chairs",
      kind: "object",
      category: "Dining",
      type: "round-table",
      size: { w: 2_000, d: 2_000, h: 850 },
      parts: [
        nest("Table", "std:round-table", 0, 0, 0, 1_200, 1_200, 740),
        nest("Chair", "std:chair", 0, 750, 0, 500, 500, 850),
        nest("Chair", "std:chair", 0, -750, 0, 500, 500, 850, 180),
        nest("Chair", "std:chair", 750, 0, 0, 500, 500, 850, -90),
        nest("Chair", "std:chair", -750, 0, 0, 500, 500, 850, 90),
      ],
      symbol: "parts",
      description: "A round table and four chairs, nested from the Round table and Chair blueprints.",
      revision: 1,
    },
    {
      id: "std:phone-booth",
      name: "Phone booth",
      kind: "object",
      category: "Meeting",
      type: "box",
      size: { w: 1_200, d: 1_200, h: 2_300 },
      parts: [
        nest("Back wall", "std:wall-acoustic-150", 0, 525, 0, 1_200, 150, 2_300, 180),
        nest("Side wall", "std:wall-acoustic-150", -525, 0, 0, 900, 150, 2_300, -90),
        nest("Side wall", "std:wall-acoustic-150", 525, 0, 0, 900, 150, 2_300, 90),
        nest("Glass front", "std:wall-glass-partition", 0, -594, 0, 1_200, 12, 2_300),
        p("Roof", "box", 0, 0, 2_250, 1_200, 1_200, 50, "felt-grey"),
        p("Ledge", "box", 0, 300, 1_000, 900, 300, 30, "oak"),
        nest("Stool", "std:side-table", 0, -100, 0, 400, 400, 600),
      ],
      symbol: "parts",
      description: "Acoustic walls and a glass front, built from two wall types.",
      revision: 1,
    },
    {
      id: "std:lounge-set",
      name: "Lounge set",
      kind: "object",
      category: "Lounge",
      type: "sofa",
      size: { w: 3_200, d: 2_800, h: 800 },
      parts: [
        nest("Rug", "std:rug", 0, 0, 0, 3_000, 2_400, 10),
        nest("Sofa", "std:sofa", 0, 900, 10, 2_200, 900, 800),
        nest("Armchair", "std:armchair", -1_100, -400, 10, 850, 850, 800, 120),
        nest("Armchair", "std:armchair", 1_100, -400, 10, 850, 850, 800, -120),
        nest("Coffee table", "std:coffee-table", 0, -100, 10, 1_100, 600, 400),
        nest("Plant", "std:plant", 1_400, 1_100, 10, 500, 500, 1_400),
      ],
      symbol: "parts",
      description: "A sofa, two armchairs, a coffee table, a plant and a rug.",
      revision: 1,
    },
    {
      id: "std:pendant-light",
      name: "Pendant light",
      kind: "object",
      category: "Lighting",
      type: "box",
      size: { w: 450, d: 450, h: 2_700 },
      parts: [p("Cord", "cylinder", 0, 0, 2_250, 8, 8, 450, "black-steel"), p("Shade", "sphere", 0, 0, 1_950, 450, 450, 320, "brass")],
      symbol: "parts",
      description: "Hangs from a 2,700 mm ceiling down to 1,950 mm.",
      revision: 1,
    },
    {
      id: "std:floor-lamp",
      name: "Floor lamp",
      kind: "object",
      category: "Lighting",
      type: "box",
      size: { w: 400, d: 400, h: 1_600 },
      parts: [p("Base", "cylinder", 0, 0, 0, 300, 300, 25, "black-steel"), p("Stem", "cylinder", 0, 0, 25, 25, 25, 1_300, "black-steel"), p("Shade", "cylinder", 0, 0, 1_300, 400, 400, 300, "linen")],
      symbol: "parts",
      revision: 1,
    },
    {
      id: "std:wall-panel",
      name: "Timber wall panel",
      kind: "object",
      category: "Decor",
      type: "box",
      size: { w: 1_200, d: 40, h: 2_400 },
      parts: Array.from({ length: 8 }, (_, i) => p("Slat", "box", -525 + i * 150, 0, 0, 90, 40, 2_400, "oak")),
      symbol: "parts",
      description: "Vertical oak slats on a 150 mm spacing.",
      revision: 1,
    },
  );
  return out;
}

export const STANDARD_BLUEPRINTS: Blueprint[] = build();
const BY_ID = new Map(STANDARD_BLUEPRINTS.map((b) => [b.id, b]));
export function standardBlueprint(id: string): Blueprint | undefined {
  return BY_ID.get(id);
}
