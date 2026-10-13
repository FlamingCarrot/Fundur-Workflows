import { roomArea, type Plan } from "./geometry";
import { STANDARD, type Resolver } from "@/lib/blueprints/resolve";

/**
 * Colour fills (Revit's Color Fill Legend): rooms tinted by what they are
 * called, their floor finish or their size, with a legend that totals the
 * area of each colour. Rooms of the same name ("Meeting room") share a
 * colour, so a space plan reads at a glance.
 */

export type ColourBy = "none" | "name" | "finish" | "size";
export const COLOUR_BY: { key: ColourBy; label: string }[] = [
  { key: "none", label: "No colour" },
  { key: "name", label: "Room name" },
  { key: "finish", label: "Floor finish" },
  { key: "size", label: "Size" },
];

/** Soft, distinct tints that keep walls and text readable on top. */
export const FILL_PALETTE = ["#cfe3b4", "#b9d7e8", "#f2d4a7", "#e3c3df", "#c9e4d8", "#f3c2b3", "#d8d2ef", "#f1e3a2", "#bfd0c4", "#e8c8c8", "#c6d9f1", "#dfe7b0"];

export interface LegendRow {
  label: string;
  colour: string;
  rooms: number;
  /** m². */
  area: number;
}

const SIZES: { max: number; label: string }[] = [
  { max: 10, label: "Under 10 m²" },
  { max: 25, label: "10 to 25 m²" },
  { max: 50, label: "25 to 50 m²" },
  { max: 100, label: "50 to 100 m²" },
  { max: Infinity, label: "100 m² and over" },
];

/** A stable colour for a word, so "Kitchen" keeps its colour from plan to plan. */
function colourFor(key: string): string {
  let h = 0;
  for (const ch of key.trim().toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return FILL_PALETTE[h % FILL_PALETTE.length];
}

/** The tint for each room on a floor, and the legend for it. */
export function colourFill(plan: Plan, levelId: string, by: ColourBy, lib: Resolver = STANDARD): { fills: Map<string, string>; legend: LegendRow[] } {
  const fills = new Map<string, string>();
  if (by === "none") return { fills, legend: [] };
  const rows = new Map<string, LegendRow>();
  const used = new Set<string>();
  for (const r of plan.rooms) {
    if (r.levelId !== levelId) continue;
    const area = roomArea(r);
    let label: string;
    let colour: string;
    if (by === "size") {
      const i = SIZES.findIndex((s) => area < s.max);
      label = SIZES[i].label;
      colour = ["#e4efd6", "#cfe3b4", "#b2d391", "#93c06d", "#77a851"][i];
    } else if (by === "finish") {
      const m = r.floorMaterial ? lib.material(r.floorMaterial) : undefined;
      label = m?.name ?? "No finish set";
      colour = m ? m.color : "#e6e4de";
    } else {
      label = r.name.trim() || "Unnamed";
      colour = colourFor(label);
    }
    // Two names landing on one tint: the later takes the next free one.
    const key = label.toLowerCase();
    if (by === "name" && !rows.has(key)) {
      let k = FILL_PALETTE.indexOf(colour);
      for (let n = 0; n < FILL_PALETTE.length && used.has(colour); n++) colour = FILL_PALETTE[(k = (k + 1) % FILL_PALETTE.length)];
      used.add(colour);
    }
    const row = rows.get(key) ?? { label, colour, rooms: 0, area: 0 };
    row.rooms += 1;
    row.area += area;
    rows.set(key, row);
    fills.set(r.id, row.colour);
  }
  const legend = [...rows.values()].map((r) => ({ ...r, area: Math.round(r.area * 100) / 100 }));
  if (by === "size") legend.sort((a, b) => SIZES.findIndex((s) => s.label === a.label) - SIZES.findIndex((s) => s.label === b.label));
  else legend.sort((a, b) => b.area - a.area);
  return { fills, legend };
}
