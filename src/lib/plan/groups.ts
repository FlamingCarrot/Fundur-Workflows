import { z } from "zod";
import {
  LIMITS,
  newId,
  type EditResult,
  type Item,
  type Plan,
  type Point,
} from "./geometry";

const coord = z.number().finite().min(-LIMITS.maxCoord).max(LIMITS.maxCoord);
const size = z.number().positive().max(LIMITS.maxWall);
export const assemblyInput = z.object({
  name: z.string().trim().min(1).max(120),
  items: z
    .array(
      z.object({
        type: z.string().min(1).max(64),
        at: z.object({ x: coord, y: coord }),
        width: size,
        depth: size,
        rotation: z.number().finite(),
        label: z.string().max(120).optional(),
        color: z
          .string()
          .regex(/^#[0-9a-fA-F]{6}$/)
          .optional(),
      }),
    )
    .min(1)
    .max(500),
});
export type AssemblyInput = z.infer<typeof assemblyInput>;
export type Assembly = AssemblyInput & { id: string; createdAt: string };
const fail = (error: string): EditResult => ({ ok: false, error });

export function selectedFurniture(plan: Plan, ids: readonly string[]): Item[] {
  const wanted = new Set(ids);
  return plan.items.filter((i) => wanted.has(i.id));
}
function checked(plan: Plan, ids: readonly string[]): Item[] | string {
  const items = selectedFurniture(plan, ids);
  if (!items.length || items.length !== new Set(ids).size)
    return "Choose furniture that is still on the plan.";
  if (new Set(items.map((i) => i.levelId)).size !== 1)
    return "Choose furniture on one floor.";
  return items;
}
export function editFurniture(
  plan: Plan,
  ids: readonly string[],
  action: "move" | "rotate" | "delete" | "duplicate" | "group" | "ungroup",
  options: { delta?: Point; name?: string } = {},
): EditResult {
  const items = checked(plan, ids);
  if (typeof items === "string") return fail(items);
  const keys = new Set(ids);
  const centre = {
    x: items.reduce((s, i) => s + i.at.x, 0) / items.length,
    y: items.reduce((s, i) => s + i.at.y, 0) / items.length,
  };
  const groupId = newId(),
    name = options.name?.trim().slice(0, 120) || "Furniture group";
  const delta = options.delta ?? { x: 0, y: 0 };
  if (![delta.x, delta.y].every(Number.isFinite))
    return fail("That move is invalid.");
  let copies: Item[] = [];
  const transform = (item: Item): Item => {
    const next = { ...item, at: { ...item.at } };
    if (action === "move")
      next.at = { x: item.at.x + delta.x, y: item.at.y + delta.y };
    if (action === "rotate") {
      next.at = {
        x: centre.x - (item.at.y - centre.y),
        y: centre.y + (item.at.x - centre.x),
      };
      next.rotation = (item.rotation + 90) % 360;
    }
    if (action === "group") {
      next.groupId = groupId;
      next.groupName = name;
    }
    if (action === "ungroup") {
      delete next.groupId;
      delete next.groupName;
    }
    return next;
  };
  if (action === "duplicate") {
    const groupMap = new Map<string, string>();
    copies = items.map((i) => {
      const copy = {
        ...i,
        id: newId(),
        at: { x: i.at.x + 500, y: i.at.y - 500 },
      };
      if (i.groupId) {
        if (!groupMap.has(i.groupId)) groupMap.set(i.groupId, newId());
        copy.groupId = groupMap.get(i.groupId)!;
      }
      return copy;
    });
  }
  const nextItems =
    action === "delete"
      ? plan.items.filter((i) => !keys.has(i.id))
      : action === "duplicate"
        ? [...plan.items, ...copies]
        : plan.items.map((i) => (keys.has(i.id) ? transform(i) : i));
  if (
    nextItems.length > 20_000 ||
    nextItems.some(
      (i) =>
        Math.abs(i.at.x) > LIMITS.maxCoord ||
        Math.abs(i.at.y) > LIMITS.maxCoord,
    )
  )
    return fail("That arrangement is outside the plan limits.");
  return {
    ok: true,
    plan: { ...plan, items: nextItems },
    id: copies[0]?.id,
    summary:
      action === "group"
        ? `${items.length} items grouped as ${name}`
        : `${items.length} furniture item${items.length === 1 ? "" : "s"} ${action === "rotate" ? "turned together" : action === "move" ? "moved together" : action === "ungroup" ? "ungrouped" : action === "delete" ? "removed" : "copied"}`,
  };
}
export function makeAssembly(
  plan: Plan,
  ids: readonly string[],
  name: string,
): AssemblyInput {
  const items = checked(plan, ids);
  if (typeof items === "string") throw new Error(items);
  const cx = items.reduce((s, i) => s + i.at.x, 0) / items.length,
    cy = items.reduce((s, i) => s + i.at.y, 0) / items.length;
  // Whitelist only furniture facts. No project/group ids, visibility or working notes.
  return assemblyInput.parse({
    name,
    items: items.map((i) => ({
      type: i.type,
      at: { x: i.at.x - cx, y: i.at.y - cy },
      width: i.width,
      depth: i.depth,
      rotation: i.rotation,
      ...(i.label ? { label: i.label } : {}),
      ...(i.color ? { color: i.color } : {}),
    })),
  });
}
export function placeAssembly(
  plan: Plan,
  assembly: AssemblyInput,
  levelId: string,
  at: Point,
): EditResult {
  const parsed = assemblyInput.safeParse(assembly);
  if (!parsed.success) return fail("That saved arrangement is invalid.");
  if (!plan.levels.some((l) => l.id === levelId))
    return fail("That floor is no longer on the plan.");
  const groupId = newId();
  const items: Item[] = parsed.data.items.map((i) => ({
    ...i,
    id: newId(),
    levelId,
    at: { x: i.at.x + at.x, y: i.at.y + at.y },
    groupId,
    groupName: parsed.data.name,
  }));
  if (
    plan.items.length + items.length > 20_000 ||
    items.some(
      (i) =>
        !Number.isFinite(i.at.x) ||
        !Number.isFinite(i.at.y) ||
        Math.abs(i.at.x) > LIMITS.maxCoord ||
        Math.abs(i.at.y) > LIMITS.maxCoord,
    )
  )
    return fail("That arrangement is outside the plan limits.");
  return {
    ok: true,
    plan: { ...plan, items: [...plan.items, ...items] },
    id: items[0].id,
    summary: `${assembly.name} placed (${items.length} items)`,
  };
}
