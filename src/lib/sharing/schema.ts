import { z } from "zod";

export const createShareInput = z
  .object({
    targetType: z.enum(["document", "brief", "plan"]),
    targetId: z.string().max(100).optional(),
    mode: z.enum(["live", "snapshot"]),
    permission: z.enum(["view", "comment", "edit"]),
    expiresAt: z.string().datetime({ offset: true }).nullable().optional(),
  })
  .strict()
  .superRefine((input, ctx) => {
    if (
      input.targetType === "document" &&
      !z.string().uuid().safeParse(input.targetId).success
    )
      ctx.addIssue({
        code: "custom",
        message: "Choose a document",
        path: ["targetId"],
      });
    if (
      input.permission === "edit" &&
      (input.targetType !== "brief" || input.mode !== "live")
    )
      ctx.addIssue({
        code: "custom",
        message: "Editing is available for live briefs only",
        path: ["permission"],
      });
  });
export type CreateShareInput = z.infer<typeof createShareInput>;
export const visibilityInput = z
  .object({
    targetType: z.enum(["document", "brief", "plan", "phase"]),
    targetId: z.string().min(1).max(100).optional(),
    clientVisible: z.boolean(),
  })
  .strict();
export const commentInput = z
  .object({
    authorName: z.string().trim().min(1).max(100),
    body: z.string().trim().min(1).max(5000),
    parentId: z.string().uuid().nullable().optional(),
  })
  .strict();
export const editBriefInput = z
  .object({
    patch: z
      .record(z.string().min(1).max(100), z.string().max(20_000))
      .refine(
        (v) => Object.keys(v).length > 0 && Object.keys(v).length <= 100,
        "Choose fields to edit",
      ),
  })
  .strict();
