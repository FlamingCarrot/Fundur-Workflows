import { ITEM_NAMES } from "./geometry";

/**
 * The furniture and fittings library: what can be placed on a plan, its usual
 * size, and how it is drawn from above. Shapes are in millimetres around the
 * item's middle, y up, for an item of the size given, so a resized desk is
 * drawn at its new size.
 */

export type Shape =
  | { t: "rect"; x: number; y: number; w: number; h: number; r?: number }
  | { t: "circle"; x: number; y: number; r: number }
  | { t: "line"; x1: number; y1: number; x2: number; y2: number };

export type Category = "Work" | "Meeting" | "Lounge" | "Kitchen" | "Bathroom" | "Storage" | "Other";

export interface LibraryItem {
  type: string;
  name: string;
  category: Category;
  width: number;
  depth: number;
  /** For IFC and 3D, in mm. */
  height: number;
  draw: (w: number, d: number) => Shape[];
}

const box = (w: number, d: number, r = 0): Shape => ({ t: "rect", x: -w / 2, y: -d / 2, w, h: d, r });

/** A chair seen from above: a seat with its back along the top edge. */
function chair(w: number, d: number): Shape[] {
  return [
    { t: "rect", x: -w / 2, y: -d / 2, w, h: d * 0.8, r: Math.min(w, d) * 0.15 },
    { t: "rect", x: -w / 2, y: d / 2 - d * 0.2, w, h: d * 0.2, r: d * 0.08 },
  ];
}

/** Chairs set round a table edge, facing in. */
function chairsAlong(x1: number, x2: number, y: number, count: number, facing: 1 | -1): Shape[] {
  const out: Shape[] = [];
  const cw = 450;
  for (let i = 0; i < count; i++) {
    const cx = x1 + ((i + 0.5) * (x2 - x1)) / count;
    out.push({ t: "rect", x: cx - cw / 2, y: facing === 1 ? y : y - 400, w: cw, h: 400, r: 60 });
  }
  return out;
}

export const LIBRARY: LibraryItem[] = [
  // Work
  { type: "desk", name: "Desk", category: "Work", width: 1_600, depth: 800, height: 730, draw: (w, d) => [box(w, d)] },
  {
    type: "desk-chair",
    name: "Desk with chair",
    category: "Work",
    width: 1_600,
    depth: 1_400,
    height: 730,
    draw: (w, d) => [
      { t: "rect", x: -w / 2, y: d / 2 - 800, w, h: 800 },
      { t: "rect", x: -250, y: -d / 2, w: 500, h: 500, r: 80 },
    ],
  },
  {
    type: "desk-l",
    name: "Corner desk",
    category: "Work",
    width: 1_600,
    depth: 1_600,
    height: 730,
    draw: (w, d) => [
      { t: "rect", x: -w / 2, y: d / 2 - 800, w, h: 800 },
      { t: "rect", x: -w / 2, y: -d / 2, w: 800, h: d - 800 },
    ],
  },
  { type: "office-chair", name: "Office chair", category: "Work", width: 600, depth: 600, height: 1_000, draw: chair },
  {
    type: "reception",
    name: "Reception desk",
    category: "Work",
    width: 2_400,
    depth: 900,
    height: 1_100,
    draw: (w, d) => [box(w, d), { t: "line", x1: -w / 2, y1: -d / 2 + 300, x2: w / 2, y2: -d / 2 + 300 }],
  },
  {
    type: "printer",
    name: "Printer",
    category: "Work",
    width: 700,
    depth: 600,
    height: 1_100,
    draw: (w, d) => [box(w, d), { t: "line", x1: -w / 2 + 80, y1: d / 2 - 120, x2: w / 2 - 80, y2: d / 2 - 120 }],
  },
  // Meeting
  {
    type: "meeting-table",
    name: "Meeting table",
    category: "Meeting",
    width: 2_400,
    depth: 1_200,
    height: 740,
    draw: (w, d) => {
      const seats = Math.max(1, Math.floor(w / 700));
      return [box(w, d, 60), ...chairsAlong(-w / 2, w / 2, d / 2 + 50, seats, 1), ...chairsAlong(-w / 2, w / 2, -d / 2 - 50, seats, -1)];
    },
  },
  {
    type: "round-table",
    name: "Round table",
    category: "Meeting",
    width: 1_200,
    depth: 1_200,
    height: 740,
    draw: (w) => [{ t: "circle", x: 0, y: 0, r: w / 2 }],
  },
  { type: "chair", name: "Chair", category: "Meeting", width: 500, depth: 500, height: 850, draw: chair },
  {
    type: "screen",
    name: "Wall screen",
    category: "Meeting",
    width: 1_600,
    depth: 120,
    height: 950,
    draw: (w, d) => [box(w, d), { t: "line", x1: -w / 2, y1: -d / 2, x2: w / 2, y2: d / 2 }],
  },
  {
    type: "whiteboard",
    name: "Whiteboard",
    category: "Meeting",
    width: 1_800,
    depth: 60,
    height: 1_200,
    draw: (w, d) => [box(w, d)],
  },
  // Lounge
  {
    type: "sofa",
    name: "Sofa",
    category: "Lounge",
    width: 2_000,
    depth: 900,
    height: 800,
    draw: (w, d) => [
      box(w, d, 120),
      { t: "rect", x: -w / 2 + 180, y: -d / 2, w: w - 360, h: d - 220, r: 80 },
    ],
  },
  {
    type: "armchair",
    name: "Armchair",
    category: "Lounge",
    width: 850,
    depth: 850,
    height: 800,
    draw: (w, d) => [box(w, d, 120), { t: "rect", x: -w / 2 + 150, y: -d / 2, w: w - 300, h: d - 200, r: 60 }],
  },
  { type: "coffee-table", name: "Coffee table", category: "Lounge", width: 1_100, depth: 600, height: 400, draw: (w, d) => [box(w, d, 40)] },
  { type: "side-table", name: "Side table", category: "Lounge", width: 500, depth: 500, height: 550, draw: (w) => [{ t: "circle", x: 0, y: 0, r: w / 2 }] },
  {
    type: "plant",
    name: "Plant",
    category: "Lounge",
    width: 600,
    depth: 600,
    height: 1_500,
    draw: (w) => [
      { t: "circle", x: 0, y: 0, r: w / 2 },
      { t: "circle", x: 0, y: 0, r: w / 5 },
    ],
  },
  {
    type: "rug",
    name: "Rug",
    category: "Lounge",
    width: 2_400,
    depth: 1_700,
    height: 10,
    draw: (w, d) => [box(w, d), box(w - 120, d - 120)],
  },
  // Kitchen
  {
    type: "counter",
    name: "Counter",
    category: "Kitchen",
    width: 2_400,
    depth: 600,
    height: 900,
    draw: (w, d) => [box(w, d), { t: "line", x1: -w / 2, y1: -d / 2 + 50, x2: w / 2, y2: -d / 2 + 50 }],
  },
  {
    type: "kitchen-sink",
    name: "Kitchen sink",
    category: "Kitchen",
    width: 1_000,
    depth: 600,
    height: 900,
    draw: (w, d) => [box(w, d), { t: "rect", x: -w / 2 + 100, y: -d / 2 + 90, w: w / 2 - 50, h: d - 180, r: 40 }, { t: "circle", x: w / 4, y: d / 4, r: 30 }],
  },
  {
    type: "hob",
    name: "Hob",
    category: "Kitchen",
    width: 600,
    depth: 600,
    height: 900,
    draw: (w, d) => [
      box(w, d),
      { t: "circle", x: -w / 4, y: -d / 4, r: 90 },
      { t: "circle", x: w / 4, y: -d / 4, r: 90 },
      { t: "circle", x: -w / 4, y: d / 4, r: 90 },
      { t: "circle", x: w / 4, y: d / 4, r: 90 },
    ],
  },
  {
    type: "fridge",
    name: "Fridge",
    category: "Kitchen",
    width: 700,
    depth: 700,
    height: 1_850,
    draw: (w, d) => [box(w, d), { t: "line", x1: -w / 2, y1: -d / 2, x2: w / 2, y2: d / 2 }, { t: "line", x1: -w / 2, y1: d / 2, x2: w / 2, y2: -d / 2 }],
  },
  {
    type: "dishwasher",
    name: "Dishwasher",
    category: "Kitchen",
    width: 600,
    depth: 600,
    height: 850,
    draw: (w, d) => [box(w, d), { t: "line", x1: -w / 2, y1: -d / 2, x2: w / 2, y2: d / 2 }],
  },
  {
    type: "island",
    name: "Island",
    category: "Kitchen",
    width: 2_000,
    depth: 1_000,
    height: 900,
    draw: (w, d) => [box(w, d, 30)],
  },
  // Bathroom
  {
    type: "wc",
    name: "Toilet",
    category: "Bathroom",
    width: 400,
    depth: 700,
    height: 800,
    draw: (w, d) => [
      { t: "rect", x: -w / 2, y: d / 2 - 180, w, h: 180, r: 30 },
      { t: "rect", x: -w / 2 + 20, y: -d / 2, w: w - 40, h: d - 200, r: (w - 40) / 2 },
    ],
  },
  {
    type: "basin",
    name: "Basin",
    category: "Bathroom",
    width: 550,
    depth: 450,
    height: 850,
    draw: (w, d) => [box(w, d, 40), { t: "rect", x: -w / 2 + 70, y: -d / 2 + 60, w: w - 140, h: d - 160, r: 120 }],
  },
  {
    type: "shower",
    name: "Shower",
    category: "Bathroom",
    width: 900,
    depth: 900,
    height: 2_000,
    draw: (w, d) => [box(w, d), { t: "line", x1: -w / 2, y1: -d / 2, x2: w / 2, y2: d / 2 }, { t: "circle", x: 0, y: 0, r: 40 }],
  },
  {
    type: "bath",
    name: "Bath",
    category: "Bathroom",
    width: 1_700,
    depth: 750,
    height: 550,
    draw: (w, d) => [box(w, d, 40), { t: "rect", x: -w / 2 + 80, y: -d / 2 + 80, w: w - 160, h: d - 160, r: 250 }],
  },
  {
    type: "urinal",
    name: "Urinal",
    category: "Bathroom",
    width: 400,
    depth: 350,
    height: 600,
    draw: (w, d) => [{ t: "rect", x: -w / 2, y: -d / 2, w, h: d, r: w / 3 }],
  },
  // Storage
  {
    type: "cupboard",
    name: "Cupboard",
    category: "Storage",
    width: 1_200,
    depth: 450,
    height: 2_000,
    draw: (w, d) => [box(w, d), { t: "line", x1: 0, y1: -d / 2, x2: 0, y2: d / 2 }],
  },
  {
    type: "shelving",
    name: "Shelving",
    category: "Storage",
    width: 1_000,
    depth: 350,
    height: 2_000,
    draw: (w, d) => [box(w, d), { t: "line", x1: -w / 2, y1: 0, x2: w / 2, y2: 0 }],
  },
  {
    type: "filing",
    name: "Filing cabinet",
    category: "Storage",
    width: 500,
    depth: 600,
    height: 1_300,
    draw: (w, d) => [box(w, d), { t: "line", x1: -w / 2, y1: -d / 2 + 80, x2: w / 2, y2: -d / 2 + 80 }],
  },
  {
    type: "lockers",
    name: "Lockers",
    category: "Storage",
    width: 1_200,
    depth: 500,
    height: 1_800,
    draw: (w, d) => {
      const n = Math.max(1, Math.round(w / 400));
      return [box(w, d), ...Array.from({ length: n - 1 }, (_, i): Shape => ({ t: "line", x1: -w / 2 + ((i + 1) * w) / n, y1: -d / 2, x2: -w / 2 + ((i + 1) * w) / n, y2: d / 2 }))];
    },
  },
  // Other
  { type: "bed-double", name: "Double bed", category: "Other", width: 1_600, depth: 2_000, height: 500, draw: (w, d) => [box(w, d), { t: "rect", x: -w / 2 + 80, y: d / 2 - 450, w: w / 2 - 120, h: 350, r: 60 }, { t: "rect", x: 40, y: d / 2 - 450, w: w / 2 - 120, h: 350, r: 60 }] },
  { type: "stair", name: "Stair", category: "Other", width: 1_200, depth: 3_000, height: 3_000, draw: (w, d) => {
    const steps = Math.max(2, Math.round(d / 280));
    return [box(w, d), ...Array.from({ length: steps - 1 }, (_, i): Shape => ({ t: "line", x1: -w / 2, y1: -d / 2 + ((i + 1) * d) / steps, x2: w / 2, y2: -d / 2 + ((i + 1) * d) / steps })), { t: "line", x1: 0, y1: -d / 2, x2: 0, y2: d / 2 }];
  } },
  { type: "box", name: "Box (any item)", category: "Other", width: 1_000, depth: 1_000, height: 1_000, draw: (w, d) => [box(w, d), { t: "line", x1: -w / 2, y1: -d / 2, x2: w / 2, y2: d / 2 }] },
];

export const CATEGORIES: Category[] = ["Work", "Meeting", "Lounge", "Kitchen", "Bathroom", "Storage", "Other"];

const BY_TYPE = new Map(LIBRARY.map((i) => [i.type, i]));
for (const item of LIBRARY) ITEM_NAMES[item.type] = item.name;

export function libraryItem(type: string): LibraryItem {
  return BY_TYPE.get(type) ?? BY_TYPE.get("box")!;
}
