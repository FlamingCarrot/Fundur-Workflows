import { normalizePlan, type Plan } from "@/lib/plan/geometry";
/** Geometry and the current furniture only; working notes and imported references remain private. */
export function publicPlan(input: Plan): Plan {
  const p = normalizePlan(input);
  return {
    version: 1,
    levels: p.levels,
    walls: p.walls,
    openings: p.openings,
    columns: p.columns,
    rooms: p.rooms,
    // Group names and visibility are internal working-view metadata.
    items: p.items.map((i) => ({ id: i.id, levelId: i.levelId, type: i.type, at: i.at, width: i.width, depth: i.depth, rotation: i.rotation, ...(i.label ? { label: i.label } : {}), ...(i.color ? { color: i.color } : {}) })),
    dimensions: p.dimensions,
    notes: [],
    underlays: [],
    reference: [],
    layouts: [],
  };
}
