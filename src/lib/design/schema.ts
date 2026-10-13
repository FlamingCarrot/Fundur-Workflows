import { z } from "zod";
import { rfqDraftSchema } from "@/lib/sourcing/schema";
import { supplierEvidenceSchema } from "@/lib/sourcing/import-schema";
import { boardElementSchema, WB_LIMIT } from "@/lib/whiteboard/types";

export const ITEM_STATUSES = [
  "needs_sourcing",
  "quote_requested",
  "ordered",
  "delivered",
] as const;
const text = (max: number) => z.string().max(max);
const uuid = z.uuid();
const cents = z.number().int().min(0).max(1_000_000_000_000);
const tags = z.array(z.string().trim().min(1).max(60)).max(20);
export const boardCardSchema = z
  .object({
    id: uuid,
    title: text(200),
    body: text(5000),
    tags,
    group: text(100),
    documentId: uuid.nullable(),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    /** Where it sits on the board's endless canvas, in board units. */
    x: z.number().finite().min(-200_000).max(200_000),
    y: z.number().finite().min(-200_000).max(200_000),
    width: z.number().min(60).max(4000),
    /** Older cards have no height; the whiteboard gives them one from their image. */
    height: z.number().min(40).max(4000).optional(),
    z: z.number().finite().optional(),
    rotation: z.number().finite().min(-360).max(360).optional(),
    locked: z.boolean().optional(),
    groupId: z.string().max(64).optional(),
  })
  .strict();
export const boardSchema = z
  .object({
    id: uuid,
    key: z.string().regex(/^[a-z][a-z0-9_-]{0,59}$/),
    cards: z.array(boardCardSchema).max(500),
    /** The whiteboard's stickies, shapes, text, connectors, drawings and frames. */
    elements: z.array(boardElementSchema).max(WB_LIMIT).optional(),
  })
  .strict();
export const designItemSchema = z
  .object({
    id: uuid,
    name: z.string().trim().min(1).max(200),
    category: text(100),
    tags,
    documentId: uuid.nullable(),
    sourceCardId: uuid.nullable(),
    specification: text(5000),
    dimensions: text(500),
    quantity: z.number().positive().max(1_000_000).multipleOf(0.001),
    unitPriceCents: cents.nullable(),
    status: z.enum(ITEM_STATUSES),
    supplier: text(200),
    supplierEvidence: z
      .array(supplierEvidenceSchema)
      .max(5)
      .refine(
        (entries) =>
          new Set(entries.map((e) => e.field)).size === entries.length,
        "Each imported field has one source",
      )
      .optional(),
    supplierUrl: z
      .string()
      .max(2000)
      .url()
      .refine(
        (v) => new URL(v).protocol === "https:",
        "Use an HTTPS supplier link",
      )
      .nullable(),
    deliveryDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .refine((v) => {
        const d = new Date(v + "T12:00:00Z");
        return (
          Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === v
        );
      }, "Choose a valid date")
      .nullable(),
    installDone: z.boolean(),
    notes: text(5000),
    snagDocumentIds: z.array(uuid).max(20),
  })
  .strict();
export const designDataSchema = z
  .object({
    version: z.literal(1),
    boards: z.array(boardSchema).max(20),
    items: z.array(designItemSchema).max(1000),
    currency: z.string().regex(/^[A-Z]{3}$/),
    budgetCents: cents.nullable(),
    installOrder: z.array(uuid).max(1000),
    rfqs: z.array(rfqDraftSchema).max(20).optional(),
  })
  .strict()
  .superRefine((data, ctx) => {
    const unique = (list: string[], label: string) => {
      if (new Set(list).size !== list.length)
        ctx.addIssue({ code: "custom", message: `Duplicate ${label}` });
    };
    unique(
      data.boards.map((b) => b.id),
      "board IDs",
    );
    unique(
      data.boards.map((b) => b.key),
      "board keys",
    );
    unique(
      data.boards.flatMap((b) => b.cards.map((c) => c.id)),
      "card IDs",
    );
    unique(
      data.items.map((i) => i.id),
      "item IDs",
    );
    unique(data.installOrder, "installation items");
    unique(
      (data.rfqs ?? []).map((r) => r.id),
      "quote request IDs",
    );
    unique(
      data.items.flatMap((i) => (i.sourceCardId ? [i.sourceCardId] : [])),
      "palette selections",
    );
    if (data.installOrder.some((id) => !data.items.some((i) => i.id === id)))
      ctx.addIssue({
        code: "custom",
        message: "Installation order contains an unknown item",
      });
    for (const b of data.boards) {
      const ids = [...b.cards.map((c) => c.id), ...(b.elements ?? []).map((e) => e.id)];
      if (new Set(ids).size !== ids.length)
        ctx.addIssue({ code: "custom", message: "Duplicate board element IDs" });
    }
    const total = data.items.reduce(
      (sum, i) =>
        sum +
        (i.unitPriceCents == null
          ? BigInt(0)
          : (BigInt(i.unitPriceCents) * BigInt(Math.round(i.quantity * 1000)) +
              BigInt(500)) /
            BigInt(1000)),
      BigInt(0),
    );
    if (total > BigInt(Number.MAX_SAFE_INTEGER))
      ctx.addIssue({
        code: "custom",
        message: "The total is too large to calculate safely",
      });
  });
export const saveDesignSchema = z
  .object({ data: designDataSchema, baseRevision: z.number().int().min(0) })
  .strict();
export type BoardCard = z.infer<typeof boardCardSchema>;
export type DesignBoard = z.infer<typeof boardSchema>;
export type DesignItem = z.infer<typeof designItemSchema>;
export type DesignData = z.infer<typeof designDataSchema>;
export interface DesignState {
  data: DesignData;
  revision: number;
  updatedAt?: string;
}
