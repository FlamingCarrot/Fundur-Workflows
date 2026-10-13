import { viewCommand } from "@/lib/assistant/view-command";
import { registerTool } from "./registry";

/**
 * The plan editor's view for the assistant: 2D or 3D, the view cube's views,
 * perspective or parallel, the look, sections (cuts and section boxes that
 * isolate part of the design), looking from a saved camera, and renders to
 * download or AI renders from the clay model. It changes what she sees, not
 * the plan; cameras are saved on the plan with edit_plan.
 */

registerTool({
  name: "control_3d_view",
  module: "floor_plan_editor",
  label: "Changing the view",
  description:
    "Changes the open plan editor's view, as the designer would: switch 2D/3D; views iso (3D overview), top, front, back, left, right, bottom and corner isos; perspective or orthographic (parallel, for elevations and isometrics); look realistic, clay or lines; shadows, all floors, lowered walls; " +
    "sections that cut the model anywhere (z at a height for a plan cut, x or y for vertical cuts) or a section box / isolate around rooms, walls or furniture to show just that piece; look from a saved camera; " +
    "and renders: an image (PNG, JPEG or PDF) downloaded to her device, or an AI render that sends a clay model of the view to the image model with a design direction (costs one image); " +
    "showing or hiding kinds of things (layers); colour fill of rooms by name, finish or size with a legend; " +
    "and sheets: each floor drawn to scale (fit or 1:N) on A4 to A1 with a title block, as a PDF kept with the project's files or downloaded. " +
    "Millimetres in plan coordinates, as read_plan_detail gives them. It needs her plan editor open; say so if she is elsewhere.",
  input: viewCommand,
  async run(ctx, input) {
    const keys = Object.entries(input).filter(([, v]) => v !== undefined && v !== false);
    if (!keys.length) return { content: "Say what to change.", isError: true };
    if (input.render?.kind === "ai" && ctx.features && !ctx.features.ai) return { content: "AI is not enabled here.", isError: true };
    const open = ctx.context?.page === "plan";
    return {
      content: open
        ? `Sent to her plan editor: ${keys.map(([k]) => k).join(", ")}. It changes her view only (remembered for her), not the plan.${input.render?.kind === "ai" ? " The AI render shows in the AI render panel and is kept with the project's documents when file storage is on." : ""}`
        : "Her plan editor is not open, so the view could not change. Ask her to open the floor plan, then try again.",
      ...(open ? { view: input } : {}),
      isError: !open || undefined,
    };
  },
});

