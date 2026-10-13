import { z } from "zod";
import { roomArea, usableArea, wallLength, type Plan } from "@/lib/plan/geometry";
import { measure } from "@/lib/plan/measure";
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

const thing = z.object({ kind: z.enum(["wall", "opening", "column", "room", "item", "note"]), id: z.string().min(1).max(100) });
const end = z.union([thing, z.object({ x: z.number(), y: z.number() })]);

registerTool({
  name: "measure_plan",
  module: "floor_plan_editor",
  label: "Measuring the plan",
  description:
    "Measures on the floor plan as a tape would, to the 0.1 mm: for each pair, the clear gap between their outlines seen from above (0 when they touch or overlap), the distance between their middles, their x and y offsets, and the two points the gap runs between. " +
    "Ends are things by id (as read_plan_detail lists them) or points {x, y} in plan mm. Use it to check clearances, walkways and alignment before or after changing the plan; add a dimension with edit_plan to show one on the drawing.",
  input: z.object({ pairs: z.array(z.object({ a: end, b: end })).min(1).max(50) }),
  async run(ctx, input) {
    const state = await getPlanState(ctx.db, ctx.run.workspaceId, ctx.project.id);
    if (!state?.plan) return { content: "No floor plan has been drawn or imported for this project yet.", isError: true };
    const name = (e: z.infer<typeof end>) => ("kind" in e ? `${e.kind} ${e.id}` : `(${e.x}, ${e.y})`);
    const lines = input.pairs.map(({ a, b }) => {
      const m = measure(state.plan!, a, b);
      if (typeof m === "string") return `- ${name(a)} to ${name(b)}: ${m}`;
      return `- ${name(a)} to ${name(b)}: clear gap ${m.gap} mm${m.gap ? ` from (${m.from.x}, ${m.from.y}) to (${m.to.x}, ${m.to.y})` : " (touching or overlapping)"}; middles ${m.centres} mm apart (dx ${m.dx}, dy ${m.dy}).`;
    });
    return { content: lines.join("\n") };
  },
});
