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
    items: p.items,
    dimensions: p.dimensions,
    notes: [],
    underlays: [],
    reference: [],
    layouts: [],
  };
}
