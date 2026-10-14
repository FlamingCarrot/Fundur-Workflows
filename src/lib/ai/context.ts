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

export const PAGES = ["project", "phase", "brief", "plan", "layout", "documents", "timeline", "ai", "library", "planner", "board", "other"] as const;
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
  points: z.array(z.number().int().min(0)).max(4_000).optional(),
  handles: z.string().max(20).optional(),
  /** The mood board open on screen, and the ids of what she has selected on it. */
  boardKey: z.string().max(60).optional(),
  boardSelection: z.array(z.string().max(64)).max(200).optional(),
  /** The chat document she has open in the canvas. */
  documentId: z.string().uuid().optional(),
  /** She is talking by voice and hears the reply read aloud. */
  voice: z.boolean().optional(),
  /** The current high-level plan scratchpad / to-do list. */
  scratchpad: z
    .object({
      title: z.string().max(200),
      tasks: z.array(
        z.object({
          id: z.string().max(100),
          text: z.string().max(300),
          status: z.enum(["pending", "in_progress", "completed", "failed"]),
          note: z.string().max(300).optional(),
        })
      ).max(20),
    })
    .optional(),
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
  board: "a mood board's whiteboard",
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
      ...(context.parts?.length ? [`She has selected these parts of it: ${context.parts.slice(0, 60).map((p) => `[part ${p}]`).join(", ")}; "this part", "these" and "them" mean those.`] : []),
      ...(context.points?.length ? [`She is editing that part's points and has picked points ${context.points.slice(0, 200).join(", ")} (numbers as read_library lists them).`] : []),
      "control_blueprint_editor selects parts and points for her, switches the handles (move, turn, size, points), the view, look and snap.",
    );
  }
  if (context.boardKey) {
    lines.push(
      `She has the mood board "${context.boardKey}" open; "this board" and "here" mean it. Read it with read_board and draw on it with edit_board; the board shows your changes as they save.`,
      ...(context.boardSelection?.length ? [`On it she has selected: ${context.boardSelection.slice(0, 80).map((id) => `[${id}]`).join(", ")}; "these", "this" and "them" mean those.`] : [])
    );
  }
  if (context.documentId) {
    lines.push(
      `She has the document [document ${context.documentId}] open in the canvas next to the chat; "this", "it" and "the document" mean it. Read it with read_document and change it with edit_document; the canvas shows your changes as they save.`
    );
  }
  if (context.voice) {
    lines.push(
      "She is talking by voice and hears your reply read aloud: answer in one to three short spoken sentences with no lists, tables or links in the text. Put anything longer in chat items she can look at (create_document, show_link, show_file, show_image, deep_research) and say that it is on screen."
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
  if (context.scratchpad?.tasks.length) {
    const list = context.scratchpad.tasks
      .map((t) => `  [${t.status === "completed" ? "x" : t.status === "in_progress" ? "→" : " "}] ${t.text}${t.note ? ` (${t.note})` : ""}`)
      .join("\n");
    lines.push(`Current plan scratchpad: "${context.scratchpad.title}":\n${list}`);
  }
  return `<context>\n${lines.join("\n")}\n</context>`;
}

