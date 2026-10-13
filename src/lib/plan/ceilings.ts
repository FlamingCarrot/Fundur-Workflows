import { levelOf, LIMITS, mm, type EditResult, type Item, type Plan, type Point, type Room } from "./geometry";
import { blueprintFor, type Resolver } from "@/lib/blueprints/resolve";

/**
 * The reflected ceiling plan: each room's ceiling (plaster, a 600 or 1200
 * grid, timber slats or open to the soffit) at its height, with the lights
 * and anything else fixed up high. The floor plan's furniture steps aside.
 */

export type CeilingKind = "plaster" | "grid-600" | "grid-1200" | "slats" | "open";
export const CEILINGS: { key: CeilingKind; label: string }[] = [
  { key: "plaster", label: "Plaster" },
  { key: "grid-600", label: "Grid, 600 × 600" },
  { key: "grid-1200", label: "Grid, 1200 × 600" },
  { key: "slats", label: "Timber slats" },
  { key: "open", label: "Open to the soffit" },
];

export type PlanLook = "floor" | "ceiling";
export const isPlanLook = (v: unknown): v is PlanLook => v === "floor" || v === "ceiling";

/** The ceiling's height above the floor: the room's own, or the floor-to-ceiling of its level. */
export const ceilingHeight = (plan: Plan, room: Room) => room.ceilingHeight ?? levelOf(plan, room.levelId).height;

/** Things shown on a ceiling plan: lights, and anything lifted off the floor. */
export function onCeiling(item: Item, lib: Resolver): boolean {
  if ((item.elevation ?? 0) > 0) return true;
  const bp = blueprintFor(lib, item);
  // Lamps that stand on the floor or a desk stay with the furniture.
  return bp.category === "Lighting" && !/floor|desk|table/i.test(bp.name);
}

/** The plan as a ceiling plan draws it: furniture on the floor steps aside. */
export function ceilingPlan(plan: Plan, lib: Resolver): Plan {
  return { ...plan, items: plan.items.filter((i) => onCeiling(i, lib)) };
}

/** Sets a room's ceiling: its kind, its height (undefined: the floor's), or both. */
export function setCeiling(plan: Plan, roomId: string, patch: { kind?: CeilingKind; height?: number | null }): EditResult {
  const room = plan.rooms.find((r) => r.id === roomId);
  if (!room) return { ok: false, error: "That room is no longer on the plan." };
  const next: Room = { ...room };
  const parts: string[] = [];
  if (patch.kind && patch.kind !== (room.ceiling ?? "plaster")) {
    if (patch.kind === "plaster") delete next.ceiling;
    else next.ceiling = patch.kind;
    parts.push(CEILINGS.find((c) => c.key === patch.kind)!.label.toLowerCase());
  }
  if (patch.height !== undefined) {
    if (patch.height === null) {
      if (room.ceilingHeight !== undefined) parts.push("ceiling at the floor's height");
      delete next.ceilingHeight;
    } else {
      const h = Math.round(patch.height);
      const floor = levelOf(plan, room.levelId).height;
      if (!Number.isFinite(h) || h < 1_800 || h > Math.min(LIMITS.maxWall, floor * 3)) return { ok: false, error: `A ceiling between ${mm(1_800)} and ${mm(Math.min(LIMITS.maxWall, floor * 3))} high.` };
      if (h !== room.ceilingHeight) parts.push(`ceiling at ${mm(h)}`);
      next.ceilingHeight = h;
    }
  }
  if (!parts.length) return { ok: true, plan, summary: "" };
  return { ok: true, plan: { ...plan, rooms: plan.rooms.map((r) => (r.id === roomId ? next : r)) }, summary: `${room.name}: ${parts.join(", ")}` };
}

/** The lines of a ceiling's pattern across a box (mm), aligned on its middle so the grid sits centred in the room, as a setter-out would. */
export function ceilingLines(kind: CeilingKind | undefined, box: { minX: number; minY: number; maxX: number; maxY: number }): [Point, Point][] {
  const out: [Point, Point][] = [];
  if (!kind || kind === "plaster") return out;
  const cx = (box.minX + box.maxX) / 2;
  const cy = (box.minY + box.maxY) / 2;
  const along = (step: number, dir: "x" | "y") => {
    const [lo, hi, mid] = dir === "x" ? [box.minX, box.maxX, cx] : [box.minY, box.maxY, cy];
    if ((hi - lo) / step > 400) return;
    for (let v = mid - Math.ceil((mid - lo) / step) * step; v <= hi; v += step) {
      if (v < lo) continue;
      out.push(dir === "x" ? [{ x: v, y: box.minY }, { x: v, y: box.maxY }] : [{ x: box.minX, y: v }, { x: box.maxX, y: v }]);
    }
  };
  if (kind === "grid-600") {
    along(600, "x");
    along(600, "y");
  } else if (kind === "grid-1200") {
    along(1_200, "x");
    along(600, "y");
  } else if (kind === "slats") along(100, "x");
  else if (kind === "open") {
    // A sparse diagonal hatch.
    const span = box.maxX - box.minX + box.maxY - box.minY;
    if (span / 800 > 400) return out;
    for (let d = 0; d <= span; d += 800) out.push([{ x: box.minX + d, y: box.minY }, { x: box.minX, y: box.minY + d }]);
  }
  return out;
}
