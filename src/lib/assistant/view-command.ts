import { z } from "zod";

/**
 * What the assistant can do to the plan editor's view, as data: switch 2D and
 * 3D, pick a view and projection, the look, cut sections, look from a saved
 * camera, and make renders. It reaches the open editor through the chat
 * stream; nothing here changes the plan itself. Safe to import in the browser.
 */

/** What the assistant can do in the open blueprint editor: pick parts and points, the handles, the view and the snap. */
export const blueprintViewCommand = z.object({
  parts: z.union([z.array(z.string().min(1).max(60)).max(200), z.enum(["all", "none"])]).optional().describe("Parts to select, by id; all or none."),
  points: z.array(z.number().int().min(0)).max(4_000).optional().describe("Points of the one selected part to select (switches to point editing); [] clears them."),
  handles: z.enum(["move", "turn", "size", "points"]).optional().describe("Which handles the 3D view shows on the selection."),
  view: z.enum(["iso", "top", "bottom", "front", "back", "left", "right", "iso-ne", "iso-nw", "iso-se", "iso-sw"]).optional(),
  projection: z.enum(["perspective", "orthographic"]).optional(),
  style: z.enum(["realistic", "clay", "lines"]).optional(),
  snap: z.union([z.literal(0), z.literal(1), z.literal(5), z.literal(10), z.literal(50), z.literal(100)]).optional().describe("The grid point drags snap to, mm; 0 is off."),
  fit: z.boolean().optional().describe("Frames the whole model."),
});
export type BlueprintViewCommand = z.infer<typeof blueprintViewCommand>;

export const VIEW_KEYS = ["iso", "top", "bottom", "front", "back", "left", "right", "iso-ne", "iso-nw", "iso-se", "iso-sw"] as const;

const section = z.object({
  axis: z.enum(["x", "y", "z"]).describe("z cuts at a height (a plan cut); x cuts across at an x (left to right); y cuts through at a y (front to back)."),
  at: z.number().finite().min(-1_000_000).max(1_000_000).describe("Where it cuts, mm: x or y on the plan, or height above the ground floor for z."),
  keep: z.enum(["below", "above"]).optional().describe("Which side stays: below or left or front (default), or above or right or back."),
});

export const viewCommand = z.object({
  mode: z.enum(["2d", "3d"]).optional(),
  view: z.enum(VIEW_KEYS).optional().describe("iso is the 3D overview; top, front, back, left, right, bottom look straight on; iso-ne etc. are corner views."),
  projection: z.enum(["perspective", "orthographic"]).optional().describe("orthographic is parallel, for elevations, plans and isometrics."),
  style: z.enum(["realistic", "clay", "lines"]).optional().describe("realistic has materials and shadows; clay is one soft gray; lines is white with black edges."),
  shadows: z.boolean().optional(),
  allFloors: z.boolean().optional(),
  separated: z.boolean().optional().describe("Pulls floors apart when every floor is shown."),
  cutWalls: z.boolean().optional().describe("Lowers walls to 1,100 mm to see into rooms."),
  ceilings: z.boolean().optional().describe("Shows each room's ceiling in 3D at its height (plaster, grid, slats; open ceilings show nothing)."),
  floor: z.string().max(120).optional().describe("A floor's name or id to show."),
  clearSections: z.boolean().optional().describe("Removes every section first."),
  sections: z.array(section).max(12).optional().describe("Sections to add."),
  sectionBox: z
    .object({ minX: z.number(), maxX: z.number(), minY: z.number(), maxY: z.number(), bottom: z.number().optional(), top: z.number().optional() })
    .optional()
    .describe("Isolates everything inside this box (mm), like Revit's section box; replaces other sections."),
  isolate: z
    .array(z.object({ kind: z.enum(["wall", "room", "item"]), id: z.string().min(1).max(100) }))
    .max(200)
    .optional()
    .describe("Puts a section box around these and selects them."),
  lookFrom: z.string().max(100).optional().describe("A saved camera's id or name."),
  fit: z.boolean().optional().describe("Frames the whole model."),
  render: z
    .discriminatedUnion("kind", [
      z.object({ kind: z.literal("image"), format: z.enum(["png", "jpeg", "pdf"]).default("png"), size: z.enum(["hd", "4k", "square", "portrait", "a3"]).default("hd"), style: z.enum(["realistic", "clay", "lines"]).optional() }),
      z.object({ kind: z.literal("ai"), direction: z.string().trim().min(3).max(2_000) }),
    ])
    .optional()
    .describe("image downloads a render of the view to her device; ai sends a clay model of the view to the image model with the direction and shows the result."),
  layers: z
    .object(Object.fromEntries(["walls", "openings", "columns", "rooms", "furniture", "notes", "dimensions", "underlay", "below", "reference"].map((k) => [k, z.boolean().optional()])))
    .optional()
    .describe("Shows (true) or hides (false) kinds of things: walls, openings, columns, rooms, furniture, notes, dimensions, underlay (tracing image), below (the floor below, faint), reference (imported lines). In 3D only the first five apply."),
  hide: z
    .object({
      mode: z.enum(["hide", "isolate", "reset"]),
      things: z.array(z.object({ kind: z.enum(["wall", "opening", "column", "room", "item", "note", "dimension", "draft"]), id: z.string().max(80) })).max(500).default([]),
    })
    .optional()
    .describe("Temporary hide/isolate of particular things by id (as read_plan_detail lists them), in 2D and 3D, without changing the plan: hide them, isolate (show only them), or reset (show everything). Hiding more adds to what is hidden."),
  select: z
    .array(z.object({ kind: z.enum(["wall", "opening", "column", "room", "item", "note", "dimension", "draft"]), id: z.string().max(80) }))
    .max(500)
    .optional()
    .describe("Selects these for her on the plan by id (as read_plan_detail lists them), so she can see, move or change them; [] clears the selection."),
  look: z.enum(["floor", "ceiling"]).optional().describe("The 2D plan as a floor plan, or as a reflected ceiling plan (ceilings, their heights and the lights; doors and floor furniture step aside). Sheets follow it."),
  marks: z.boolean().optional().describe("Shows (true) or hides door and window marks (D01, W01) on the 2D plan and on sheets."),
  phase: z.enum(["all", "existing", "demolition", "new"]).optional().describe("Which phases show, in 2D, 3D and on sheets: all (with phase graphics: existing grey, to demolish dashed), existing (as it is before work), demolition (existing with what comes out dashed), new (existing that stays and new work)."),
  colourBy: z.enum(["none", "name", "finish", "size"]).optional().describe("Colour fill on the 2D plan: rooms tinted by name, floor finish or size, with a legend."),
  sheet: z
    .object({
      paper: z.enum(["A4", "A3", "A2", "A1"]).default("A3"),
      scale: z.union([z.literal("fit"), z.number().int().min(1).max(10_000)]).default("fit"),
      floors: z.enum(["this", "all"]).default("this"),
      title: z.string().trim().max(80).optional(),
      number: z.string().trim().max(20).optional(),
      revision: z.string().trim().max(10).optional(),
      keep: z.boolean().default(true).describe("true keeps the PDF with the project's files; false downloads it to her device."),
      colour: z.boolean().default(false).describe("Tints rooms by the colour fill (colourBy) with a legend."),
    })
    .optional()
    .describe("Prints drawing sheets: each floor to scale with a title block, as a vector PDF. Works in 2D or 3D."),
});

export type ViewCommand = z.infer<typeof viewCommand>;

/** The 3D view as the editor has it, sent with her message. */
export const viewState = z.object({
  mode: z.enum(["2d", "3d"]),
  view: z.enum(VIEW_KEYS),
  projection: z.enum(["perspective", "orthographic"]),
  style: z.enum(["realistic", "clay", "lines"]),
  sections: z.array(z.object({ axis: z.enum(["x", "y", "z"]), at: z.number(), flip: z.boolean(), enabled: z.boolean() })).max(12),
});
export type ViewState = z.infer<typeof viewState>;
