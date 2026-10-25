import { z } from "zod";
import { roomArea, usableArea, wallLength, type Plan } from "@/lib/plan/geometry";
import { measure } from "@/lib/plan/measure";
import { areaReading } from "@/lib/plan/tape";
import { outlineOf } from "@/lib/plan/selection";
import { draftArea, draftLength, isClosed } from "@/lib/plan/drafting";
import { libraryItem } from "@/lib/plan/library";
import { getPlanState } from "@/lib/plan/store";
import { registerTool } from "./registry";

/**
 * Plan reading (P4-12): the floor plan as the assistant reads it, per floor:
 * rooms with their areas, walls, openings, columns, furniture and notes.
 */

const m2 = (n: number) => `${n.toFixed(1)} m²`;
const metres = (mm: number) => `${(mm / 1000).toFixed(1)} m`;

export function summarisePlan(plan: Plan): string {
  const lines: string[] = [];
  lines.push(`Usable area: ${m2(usableArea(plan))} over ${plan.levels.length} floor${plan.levels.length === 1 ? "" : "s"}.`);
  if (plan.source) lines.push(`Imported from ${plan.source.name}.`);
  for (const level of plan.levels) {
    const on = <T extends { levelId?: string }>(list: T[]) => list.filter((x) => x.levelId === level.id);
    const walls = on(plan.walls);
    const wallIds = new Set(walls.map((w) => w.id));
    const openings = plan.openings.filter((o) => wallIds.has(o.wallId));
    const rooms = on(plan.rooms);
    const items = on(plan.items);
    const notes = on(plan.notes);
    lines.push("");
    lines.push(`${level.name} (floor to ceiling ${metres(level.height)}):`);
    const full = walls.filter((w) => w.kind === "wall");
    const partitions = walls.filter((w) => w.kind === "partition");
    lines.push(
      `- Walls: ${full.length} (${metres(full.reduce((s, w) => s + wallLength(w), 0))}); partitions: ${partitions.length} (${metres(
        partitions.reduce((s, w) => s + wallLength(w), 0)
      )})`
    );
    const doors = openings.filter((o) => o.kind === "door");
    const windows = openings.filter((o) => o.kind === "window");
    lines.push(`- Doors: ${doors.length}; windows: ${windows.length}; columns: ${on(plan.columns).length}`);
    if (rooms.length) {
      lines.push(`- Rooms (${rooms.length}):`);
      for (const r of [...rooms].sort((a, b) => roomArea(b) - roomArea(a))) {
        lines.push(`  - ${r.name}: ${m2(roomArea(r))}${r.usable ? "" : " (not usable area)"}`);
      }
    } else lines.push("- No rooms marked yet.");
    if (items.length) {
      const counts = new Map<string, number>();
      for (const it of items) {
        const name = libraryItem(it.type)?.name ?? it.type;
        counts.set(name, (counts.get(name) ?? 0) + 1);
      }
      lines.push(`- Furniture and fittings: ${[...counts].map(([name, n]) => `${n} × ${name}`).join(", ")}`);
    }
    for (const n of notes.slice(0, 20)) lines.push(`- Note: "${n.text}"`);
  }
  return lines.join("\n");
}

registerTool({
  name: "read_plan",
  module: "floor_plan_editor",
  label: "Reading the plan",
  description:
    "Reads the project's floor plan: usable area, and per floor its rooms with areas, walls and partitions, doors, windows, columns, furniture counts and notes.",
  input: z.object({}),
  async run(ctx) {
    const state = await getPlanState(ctx.db, ctx.run.workspaceId, ctx.project.id);
    if (!state?.plan) return { content: "No floor plan has been drawn or imported for this project yet." };
    return {
      content: [
        summarisePlan(state.plan),
        "",
        `Saved revision ${state.revision}${state.updatedAt ? `, last changed ${state.updatedAt}` : ""}; ${state.versions.length} named version(s).`,
      ].join("\n"),
    };
  },
});

/** Area and perimeter of a thing by id or of an outline. */
function areaOf(plan: Plan, a: { kind: "room" | "draft" | "item" | "column"; id: string } | { points: { x: number; y: number }[] }): string {
  const read = (m2: number, around: number) => `${(Math.round(m2 * 100) / 100).toFixed(2)} m², perimeter ${Math.round(around)} mm`;
  if ("points" in a) return areaReading(a.points);
  if (a.kind === "draft") {
    const d = (plan.drafts ?? []).find((x) => x.id === a.id);
    if (!d) return "not on the plan.";
    return isClosed(d) ? read(draftArea(d) / 1_000_000, draftLength(d)) : `open, ${Math.round(draftLength(d))} mm long, so no area.`;
  }
  const outline = outlineOf(plan, a);
  if (!outline) return "not on the plan.";
  return areaReading(outline.points);
}

const thing = z.object({ kind: z.enum(["wall", "opening", "column", "room", "item", "note"]), id: z.string().min(1).max(100) });
const end = z.union([thing, z.object({ x: z.number(), y: z.number() })]);

registerTool({
  name: "measure_plan",
  module: "floor_plan_editor",
  label: "Measuring the plan",
  description:
    "Measures on the floor plan as a tape would, to the 0.1 mm: for each pair, the clear gap between their outlines seen from above (0 when they touch or overlap), the distance between their middles, their x and y offsets, and the two points the gap runs between. " +
    "Ends are things by id (as read_plan_detail lists them) or points {x, y} in plan mm. Use it to check clearances, walkways and alignment before or after changing the plan; add a dimension with edit_plan to show one on the drawing. " +
    "areas reads the area in m² and perimeter in mm of a room, a drawn shape, a piece of furniture or column by id, or of any outline given as points, as AutoCAD's AREA does.",
  input: z.object({
    pairs: z.array(z.object({ a: end, b: end })).max(50).optional(),
    areas: z.array(z.union([z.object({ kind: z.enum(["room", "draft", "item", "column"]), id: z.string().min(1).max(100) }), z.object({ points: z.array(z.object({ x: z.number(), y: z.number() })).min(3).max(2000) })])).max(50).optional(),
  }),
  async run(ctx, input) {
    const state = await getPlanState(ctx.db, ctx.run.workspaceId, ctx.project.id);
    if (!state?.plan) return { content: "No floor plan has been drawn or imported for this project yet.", isError: true };
    const name = (e: z.infer<typeof end>) => ("kind" in e ? `${e.kind} ${e.id}` : `(${e.x}, ${e.y})`);
    if (!input.pairs?.length && !input.areas?.length) return { content: "Give pairs to measure between, or areas to read.", isError: true };
    const lines = (input.pairs ?? []).map(({ a, b }) => {
      const m = measure(state.plan!, a, b);
      if (typeof m === "string") return `- ${name(a)} to ${name(b)}: ${m}`;
      return `- ${name(a)} to ${name(b)}: clear gap ${m.gap} mm${m.gap ? ` from (${m.from.x}, ${m.from.y}) to (${m.to.x}, ${m.to.y})` : " (touching or overlapping)"}; middles ${m.centres} mm apart (dx ${m.dx}, dy ${m.dy}).`;
    });
    for (const a of input.areas ?? []) {
      const r = areaOf(state.plan, a);
      lines.push("points" in a ? `- outline of ${a.points.length} points: ${r}` : `- ${a.kind} ${a.id}: ${r}`);
    }
    return { content: lines.join("\n") };
  },
});
