import { z } from "zod";
import { libraryItem } from "@/lib/plan/library";
import { levelOf, mm, roomArea, m2, wallLength, type Plan, type PlanItem } from "@/lib/plan/geometry";
import { viewState } from "@/lib/assistant/view-command";

/**
 * Where the designer is when she asks: the page she is on and, in the plan
 * editor, the floor she is looking at and what she has selected. The assistant
 * reads it with her message, so "make this wider" or "copy these" mean what
 * she is pointing at. Safe to import in the browser.
 */

export const PAGES = ["project", "phase", "brief", "plan", "layout", "documents", "timeline", "ai", "library", "planner", "other"] as const;
export type AssistantPage = (typeof PAGES)[number];

const planItem = z.object({
  kind: z.enum(["wall", "opening", "column", "room", "item", "note", "dimension"]),
  id: z.string().min(1).max(100),
});

export const assistantContext = z.object({
  page: z.enum(PAGES).default("other"),
  /** The phase she is looking at, when on a phase page. */
  phaseKey: z.string().max(100).optional(),
  /** The plan editor's floor. */
  levelId: z.string().max(100).optional(),
  /** What she has selected on the plan, most recent last. */
  selection: z.array(planItem).max(200).default([]),
  /** The plan editor's view: 2D or 3D, the 3D view, look and sections. */
  view: viewState.optional(),
  /** The blueprint open in the blueprint editor, and the parts she has selected in it. */
  blueprintId: z.string().max(120).optional(),
  parts: z.array(z.string().max(60)).max(200).optional(),
});

export type AssistantContext = z.infer<typeof assistantContext>;

const PAGE_NAMES: Record<AssistantPage, string> = {
  project: "the project overview",
  phase: "a phase's steps",
  brief: "the brief",
  plan: "the floor plan editor",
  layout: "the layout options",
  documents: "the documents",
  timeline: "the timeline",
  ai: "the AI spend page",
  library: "the design library",
  planner: "her planner (to-dos, board and calendar)",
  other: "the app",
};

const xy = (p: { x: number; y: number }) => `(${Math.round(p.x)}, ${Math.round(p.y)})`;

/** One selected thing in a few words, for a chip in the chat: "Wall 4.2 m", "Desk", "Boardroom". */
export function selectionLabel(plan: Plan, item: PlanItem): string | null {
  switch (item.kind) {
    case "wall": {
      const w = plan.walls.find((x) => x.id === item.id);
      return w ? `${w.kind === "partition" ? "Partition" : "Wall"} ${(wallLength(w) / 1000).toFixed(1)} m` : null;
    }
    case "opening": {
      const o = plan.openings.find((x) => x.id === item.id);
      return o ? `${o.kind === "door" ? "Door" : "Window"} ${o.width} mm` : null;
    }
    case "column":
      return plan.columns.some((x) => x.id === item.id) ? "Column" : null;
    case "room":
      return plan.rooms.find((x) => x.id === item.id)?.name ?? null;
    case "item": {
      const it = plan.items.find((x) => x.id === item.id);
      return it ? it.label || libraryItem(it.type)?.name || it.type : null;
    }
    case "note": {
      const n = plan.notes.find((x) => x.id === item.id);
      return n ? `Note "${n.text.slice(0, 24)}${n.text.length > 24 ? "…" : ""}"` : null;
    }
    case "dimension":
      return plan.dimensions.some((x) => x.id === item.id) ? "Dimension" : null;
  }
}

/** "2 desks, a wall": a whole selection in a few words. */
export function selectionSummary(plan: Plan, items: PlanItem[]): string {
  const labels = items.map((i) => selectionLabel(plan, i)).filter((l): l is string => !!l);
  if (labels.length <= 2) return labels.join(", ");
  const counts = new Map<string, number>();
  for (const i of items) counts.set(i.kind, (counts.get(i.kind) ?? 0) + 1);
  const NOUN: Record<string, [string, string]> = {
    wall: ["wall", "walls"],
    opening: ["opening", "openings"],
    column: ["column", "columns"],
    room: ["room", "rooms"],
    item: ["piece of furniture", "pieces of furniture"],
    note: ["note", "notes"],
    dimension: ["dimension", "dimensions"],
  };
  return [...counts].map(([k, n]) => `${n} ${NOUN[k][n === 1 ? 0 : 1]}`).join(", ");
}

/** One selected thing in full, with its id and where it is, for the model. */
export function describeSelected(plan: Plan, item: PlanItem): string | null {
  switch (item.kind) {
    case "wall": {
      const w = plan.walls.find((x) => x.id === item.id);
      if (!w) return null;
      const openings = plan.openings.filter((o) => o.wallId === w.id);
      return `${w.kind} [wall ${w.id}] from ${xy(w.a)} to ${xy(w.b)}, ${mm(wallLength(w))} long, ${w.thickness} mm thick, on ${levelOf(plan, w.levelId).name}${
        openings.length ? `, with ${openings.map((o) => `${o.kind} [opening ${o.id}] ${o.width} mm at ${Math.round(o.at)} mm`).join(", ")}` : ""
      }`;
    }
    case "opening": {
      const o = plan.openings.find((x) => x.id === item.id);
      return o ? `${o.kind} [opening ${o.id}] ${o.width} mm wide${o.style ? `, ${o.style}` : ""}, ${Math.round(o.at)} mm along [wall ${o.wallId}]` : null;
    }
    case "column": {
      const c = plan.columns.find((x) => x.id === item.id);
      return c ? `column [column ${c.id}] at ${xy(c.at)}, ${c.width} × ${c.depth} mm${c.round ? ", round" : ""}` : null;
    }
    case "room": {
      const r = plan.rooms.find((x) => x.id === item.id);
      return r ? `room "${r.name}" [room ${r.id}], ${m2(roomArea(r))}, corners ${r.points.map(xy).join(" ")}` : null;
    }
    case "item": {
      const it = plan.items.find((x) => x.id === item.id);
      return it
        ? `${libraryItem(it.type)?.name ?? it.type} [item ${it.id}] (type ${it.type}) at ${xy(it.at)}, ${it.width} × ${it.depth} mm, turned ${it.rotation}°${it.label ? `, labelled "${it.label}"` : ""}`
        : null;
    }
    case "note": {
      const n = plan.notes.find((x) => x.id === item.id);
      return n ? `note [note ${n.id}] "${n.text}" at ${xy(n.at)}` : null;
    }
    case "dimension": {
      const d = plan.dimensions.find((x) => x.id === item.id);
      return d ? `dimension [dimension ${d.id}] from ${xy(d.a)} to ${xy(d.b)}` : null;
    }
  }
}

/** The context as the model reads it, ahead of her words. Empty when there is nothing to say. */
export function describeContext(context: AssistantContext | undefined, plan: Plan | null, phaseName?: string): string {
  if (!context) return "";
  const lines = [`She is on ${PAGE_NAMES[context.page]}${context.page === "phase" && phaseName ? ` (${phaseName})` : ""}.`];
  if (plan && context.levelId && plan.levels.some((l) => l.id === context.levelId)) {
    lines.push(`In the plan editor she is looking at ${levelOf(plan, context.levelId).name} [level ${context.levelId}].`);
  }
  if (context.view) {
    const v = context.view;
    const cuts = v.sections.filter((s) => s.enabled);
    lines.push(
      v.mode === "3d"
        ? `The editor shows 3D: the ${v.view} view, ${v.projection}, ${v.style} look${cuts.length ? `, cut by ${cuts.map((s) => `${s.axis} at ${Math.round(s.at)}`).join(", ")}` : ""}. control_3d_view changes it.`
        : "The editor shows the 2D plan; control_3d_view can switch to 3D."
    );
  }
  if (context.blueprintId) {
    lines.push(
      `She has the blueprint [${context.blueprintId}] open in the blueprint editor; "this", "it" and "the model" mean it. Read it with read_library and change it with edit_blueprint; the editor shows your changes as they save.`,
      ...(context.parts?.length ? [`She has selected these parts of it: ${context.parts.slice(0, 60).join(", ")}.`] : [])
    );
  }
  if (plan && context.selection.length) {
    const found = context.selection.map((i) => describeSelected(plan, i)).filter((d): d is string => !!d);
    if (found.length) {
      lines.push(
        `She has selected ${found.length === 1 ? "this" : `these ${found.length}`} on the plan; "this", "these", "it" and "the selection" mean ${found.length === 1 ? "it" : "them"}:`,
        ...found.slice(0, 60).map((d) => `- ${d}`)
      );
    }
  }
  return `<context>\n${lines.join("\n")}\n</context>`;
}
