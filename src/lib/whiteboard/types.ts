import { z } from "zod";

/**
 * The whiteboard: an endless canvas of sticky notes, shapes, text, image
 * cards, connectors, pen strokes and frames, as in Miro or FigJam. Positions
 * are in board units (one unit is a pixel at 100%), x right and y down.
 * Elements are drawn in order of `z`, frames always underneath. Connectors
 * hold on to the elements they join, so moving one bends the line with it.
 * Safe in the browser and on the server.
 */

export const WB_LIMIT = 3_000;
const MAX = 200_000;
const coord = z.number().finite().min(-MAX).max(MAX);
const extent = z.number().finite().min(1).max(40_000);
const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const id = z.string().min(1).max(64);

export const SHAPES = ["rect", "rounded", "ellipse", "diamond", "triangle", "hexagon", "parallelogram", "star", "cylinder", "speech"] as const;
export type ShapeKind = (typeof SHAPES)[number];
export const SIDES = ["top", "right", "bottom", "left"] as const;
export type Side = (typeof SIDES)[number];

const base = {
  id,
  x: coord,
  y: coord,
  w: extent,
  h: extent,
  /** Degrees clockwise about the middle. */
  rotation: z.number().finite().min(-360).max(360).optional(),
  z: z.number().finite(),
  locked: z.boolean().optional(),
  /** Elements grouped together move and select as one. */
  groupId: z.string().max(64).optional(),
};

export const stickySchema = z.object({ ...base, kind: z.literal("sticky"), text: z.string().max(4_000), color: hex, fontSize: z.number().min(6).max(200).optional() }).strict();
export const shapeSchema = z
  .object({
    ...base,
    kind: z.literal("shape"),
    shape: z.enum(SHAPES),
    fill: hex.or(z.literal("none")),
    stroke: hex.or(z.literal("none")),
    strokeWidth: z.number().min(0).max(40),
    dash: z.boolean().optional(),
    text: z.string().max(4_000),
    textColor: hex.optional(),
    fontSize: z.number().min(6).max(200).optional(),
  })
  .strict();
export const textSchema = z
  .object({
    ...base,
    kind: z.literal("text"),
    text: z.string().max(10_000),
    color: hex,
    fontSize: z.number().min(6).max(400),
    align: z.enum(["left", "center", "right"]),
    bold: z.boolean().optional(),
  })
  .strict();
const endSchema = z.object({ id: id.optional(), side: z.enum(SIDES).optional(), x: coord, y: coord }).strict();
export const connectorSchema = z
  .object({
    ...base,
    kind: z.literal("connector"),
    from: endSchema,
    to: endSchema,
    route: z.enum(["straight", "elbow", "curve"]),
    stroke: hex,
    strokeWidth: z.number().min(0.5).max(40),
    dash: z.boolean().optional(),
    startArrow: z.boolean(),
    endArrow: z.boolean(),
    label: z.string().max(500).optional(),
  })
  .strict();
export const penSchema = z
  .object({
    ...base,
    kind: z.literal("pen"),
    /** x, y pairs relative to the element's corner. */
    points: z.array(z.number().finite()).min(2).max(8_000),
    stroke: hex,
    strokeWidth: z.number().min(0.5).max(80),
    /** A highlighter draws see-through and wide. */
    highlight: z.boolean().optional(),
  })
  .strict();
export const frameSchema = z.object({ ...base, kind: z.literal("frame"), title: z.string().max(200), fill: hex }).strict();
/** A mood board card: an image or a note with a title, kept for the palette and sharing. */
export const cardSchema = z
  .object({
    ...base,
    kind: z.literal("card"),
    title: z.string().max(200),
    body: z.string().max(5_000),
    tags: z.array(z.string().max(60)).max(20),
    group: z.string().max(100),
    documentId: z.string().nullable(),
    color: hex,
  })
  .strict();

export const elementSchema = z.discriminatedUnion("kind", [stickySchema, shapeSchema, textSchema, connectorSchema, penSchema, frameSchema, cardSchema]);
export type WbElement = z.infer<typeof elementSchema>;
export type WbKind = WbElement["kind"];
export type Sticky = z.infer<typeof stickySchema>;
export type ShapeEl = z.infer<typeof shapeSchema>;
export type TextEl = z.infer<typeof textSchema>;
export type Connector = z.infer<typeof connectorSchema>;
export type ConnectorEnd = z.infer<typeof endSchema>;
export type Pen = z.infer<typeof penSchema>;
export type Frame = z.infer<typeof frameSchema>;
export type CardEl = z.infer<typeof cardSchema>;
/** What is stored beside the board's cards: every element but the cards themselves. */
export type BoardElement = Exclude<WbElement, CardEl>;
export const boardElementSchema = z.discriminatedUnion("kind", [stickySchema, shapeSchema, textSchema, connectorSchema, penSchema, frameSchema]);

export const STICKY_COLORS = ["#fff1a8", "#ffd6a5", "#ffc8dd", "#cdb4db", "#bde0fe", "#b9fbc0", "#e9edc9", "#ffffff"] as const;
export const INK_COLORS = ["#1f2421", "#5c6560", "#e63946", "#f4a261", "#2a9d8f", "#3a86ff", "#8338ec", "#ffffff"] as const;
export const FILL_COLORS = ["#ffffff", "#f1efe8", "#fde2e4", "#fff1c1", "#d8f3dc", "#dbeafe", "#ede9fe", "#1f2421"] as const;
