import { libraryItem, type Shape } from "@/lib/plan/library";
import { blueprintFor, instanceShapes, STANDARD, topView, type Resolver } from "./resolve";

/**
 * How an item is drawn on the 2D plan and how tall it stands, from its
 * blueprint. Symbols are kept for the sizes seen, so redrawing the plan does not
 * flatten every nested blueprint again.
 */

/** Per blueprint object, so an edited draft or a reloaded library is drawn afresh. */
const cache = new WeakMap<object, Map<string, Shape[]>>();

export function itemSymbol(lib: Resolver = STANDARD, item: { type: string; blueprintId?: string; width: number; depth: number; height?: number }): Shape[] {
  const bp = blueprintFor(lib, item);
  if (bp.symbol === "type" && !item.blueprintId) return libraryItem(bp.type).draw(item.width, item.depth);
  if (bp.symbol === "type") return libraryItem(bp.type).draw(item.width, item.depth);
  const key = `${Math.round(item.width)}x${Math.round(item.depth)}:${lib.blueprints.length}`;
  let sizes = cache.get(bp);
  if (!sizes) cache.set(bp, (sizes = new Map()));
  const hit = sizes.get(key);
  if (hit) return hit;
  const shapes = topView(instanceShapes(lib, bp, { w: item.width, d: item.depth, h: itemHeight(lib, item) }));
  if (sizes.size > 200) sizes.clear();
  sizes.set(key, shapes);
  return shapes;
}

export function itemHeight(lib: Resolver = STANDARD, item: { type: string; blueprintId?: string; height?: number }): number {
  return item.height ?? blueprintFor(lib, item).size.h;
}

/** The name shown for an item: its blueprint's. */
export function itemBlueprintName(lib: Resolver = STANDARD, item: { type: string; blueprintId?: string }): string {
  return blueprintFor(lib, item).name;
}
