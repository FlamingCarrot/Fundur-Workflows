import { z } from "zod";
import type { Db } from "@/lib/db";
import { registerTool, type BoardEdit } from "./registry";
import { DesignConflict, DesignError, getDesign, saveDesign } from "@/lib/design/store";
import type { DesignBoard } from "@/lib/design/schema";
import { MutationError } from "@/lib/projects/store";
import { getWorkflow, label } from "@/lib/workflow";
import { boardElements, withElements } from "@/lib/whiteboard/board";
import { applyBoardOps, BoardOpError, boardOp, describeBoard } from "@/lib/whiteboard/ai";
import { UNTRUSTED_NOTE } from "./documents";
import type { Project } from "@/lib/studio/types";

/**
 * The mood boards' whiteboards for the assistant: read one with ids, and draw
 * on it with the same edits she makes (stickies, shapes, text, frames, images,
 * lines between them, moving, lining up, grouping, removing). Each call is
 * saved at once as one step; an open board shows it straight away, and Undo in
 * the chat (or Ctrl+Z on the board) takes it back.
 */

const boardKeys = (project: Project) =>
  getWorkflow(project).phases.flatMap((p) => p.modules.filter((m) => m.startsWith("canvas_board:")).map((m) => m.slice("canvas_board:".length)));

const images = (project: Project) =>
  project.documents.filter((d) => d.stored && /\.(png|jpe?g|gif|webp)$/i.test(d.name));

function pickBoard(project: Project, key: string | undefined, openKey: string | undefined): string {
  const keys = boardKeys(project);
  if (!keys.length) throw new BoardOpError("This project's workflow has no boards.");
  const want = key ?? openKey ?? (keys.length === 1 ? keys[0] : undefined);
  if (!want) throw new BoardOpError(`Say which board: ${keys.map((k) => `"${k}" (${label(project, k, "Board")})`).join(", ")}.`);
  if (!keys.includes(want)) throw new BoardOpError(`There is no board "${want}". The boards are ${keys.map((k) => `"${k}"`).join(", ")}.`);
  return want;
}

registerTool({
  name: "read_board",
  module: "canvas_board",
  label: "Reading the board",
  description:
    "Read a mood board's whiteboard: every sticky, shape, text, frame, image card and line, with its [id], words, colour and position (pixels, x right, y down). Use it before edit_board to get ids and see where there is room. Leave out `board` for the board she has open. Also lists the project images that can be pinned with add_image.",
  input: z.object({ board: z.string().max(60).optional() }).strict(),
  async run(ctx, input) {
    let key: string;
    try {
      key = pickBoard(ctx.project, input.board, ctx.context?.boardKey);
    } catch (e) {
      return { content: (e as Error).message, isError: true };
    }
    const { data } = await getDesign(ctx.db, ctx.run.workspaceId, ctx.project.id);
    const board = data.boards.find((b) => b.key === key);
    const pics = images(ctx.project);
    return {
      content: [
        `Board "${key}" (${label(ctx.project, key, "Board")}).`,
        UNTRUSTED_NOTE,
        describeBoard(boardElements(board)),
        pics.length ? `Project images that can be pinned: ${pics.slice(0, 60).map((d) => `[document ${d.id}] ${d.name}`).join("; ")}` : "The project has no uploaded images yet.",
      ].join("\n"),
    };
  },
});

registerTool({
  name: "edit_board",
  module: "canvas_board",
  label: "Drawing on the board",
  description:
    "Draw on a mood board's whiteboard, as she would. Give `steps` in order: add_sticky, add_stickies (a grid of notes), add_shape (rect, rounded, ellipse, diamond, triangle, hexagon, parallelogram, star, cylinder, speech), add_text, add_frame, add_image (a project image by document id), connect (a line from one element to another, elbow by default, with an arrow), update, move, remove, group, ungroup, align, distribute, tidy, reorder, wrap_in_frame. Give new things a `ref` so later steps can connect or move them; refer to existing ones by their [id] from read_board. Leave out x and y to have things placed clear of what is there, or give `frame` (an id or ref) to put them inside a frame, which grows to fit. Colours are names (stickies: yellow, orange, pink, purple, blue, green, olive, white; ink: black, grey, red, orange, teal, blue, purple) or hex codes. Typical layouts: a frame per theme with stickies inside, a flow of shapes joined left to right 260 px apart, a title as 48 px bold text above. Saved at once as one undoable step.",
  input: z.object({ board: z.string().max(60).optional(), steps: z.array(boardOp).min(1).max(200) }).strict(),
  async run(ctx, input) {
    let key: string;
    try {
      key = pickBoard(ctx.project, input.board, ctx.context?.boardKey);
    } catch (e) {
      return { content: (e as Error).message, isError: true };
    }
    for (let attempt = 0; attempt < 2; attempt++) {
      const state = await getDesign(ctx.db, ctx.run.workspaceId, ctx.project.id);
      const before = state.data.boards.find((b) => b.key === key) ?? null;
      let result;
      try {
        result = applyBoardOps(boardElements(before ?? undefined), input.steps, { images: new Set(images(ctx.project).map((d) => d.id)) });
      } catch (e) {
        if (e instanceof BoardOpError) return { content: `${e.message} Nothing was changed.`, isError: true };
        throw e;
      }
      const board = withElements(before ?? { id: crypto.randomUUID(), key, cards: [] }, result.els);
      const data = {
        ...state.data,
        boards: before ? state.data.boards.map((b) => (b.key === key ? board : b)) : [...state.data.boards, board],
      };
      try {
        const saved = await saveDesign(ctx.db, ctx.run.workspaceId, ctx.run.userId, ctx.project.id, data, state.revision);
        const refs = Object.entries(result.made);
        return {
          content: `Done on "${key}": ${result.changes.join("; ")}.${refs.length ? ` New ids: ${refs.map(([r, id]) => `${r} = [${id}]`).join(", ")}.` : ""}`,
          boardEdit: { key, before, board, revision: saved.revision, changes: result.changes },
        };
      } catch (e) {
        if (e instanceof DesignConflict && attempt === 0) continue;
        if (e instanceof DesignError) return { content: `The board could not be saved: ${e.message}`, isError: true };
        throw e;
      }
    }
    return { content: "The board kept changing while saving. Try again.", isError: true };
  },
});

/**
 * Takes back a board edit the assistant made, provided nothing changed the
 * project's boards since. Returns the board and revision as saved.
 */
export async function undoBoardEdit(
  db: Db,
  workspaceId: string,
  userId: string,
  slug: string,
  edit: { type: "boardEdit"; key: string; revision: number; changes: string[] },
  undo: unknown,
): Promise<{ key: string; board: DesignBoard | null; revision: number }> {
  const before = (undo as { before?: DesignBoard | null } | null)?.before ?? null;
  const state = await getDesign(db, workspaceId, slug);
  if (state.revision !== edit.revision)
    throw new MutationError("The board has changed since. Undo it on the board (Ctrl+Z) instead.");
  const data = {
    ...state.data,
    boards: before
      ? state.data.boards.some((b) => b.key === edit.key)
        ? state.data.boards.map((b) => (b.key === edit.key ? before : b))
        : [...state.data.boards, before]
      : state.data.boards.filter((b) => b.key !== edit.key),
  };
  // A card she put in the palette keeps its palette entry even if the card goes.
  const kept = new Set(data.boards.flatMap((b) => b.cards.map((c) => c.id)));
  data.items = data.items.map((i) => (i.sourceCardId && !kept.has(i.sourceCardId) ? { ...i, sourceCardId: null } : i));
  try {
    const saved = await saveDesign(db, workspaceId, userId, slug, data, state.revision);
    return { key: edit.key, board: data.boards.find((b) => b.key === edit.key) ?? null, revision: saved.revision };
  } catch (e) {
    if (e instanceof DesignConflict) throw new MutationError("The board changed while undoing. Try again.");
    if (e instanceof DesignError) throw new MutationError(e.message);
    throw e;
  }
}

/** Fits a board edit into the change log the chat shows. */
export const boardEditSummary = (edit: BoardEdit) =>
  edit.changes.length === 1 ? `Board: ${edit.changes[0]}` : `Board: ${edit.changes.length} changes (${edit.changes.slice(0, 2).join("; ")}${edit.changes.length > 2 ? "…" : ""})`;
