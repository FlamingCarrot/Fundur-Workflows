import { z } from "zod";
import { registerTool } from "./registry";
import { getDesign } from "@/lib/design/store";
import { getWorkflow } from "@/lib/workflow";
import { draftRfq } from "@/lib/sourcing/model";
import { UNTRUSTED_NOTE } from "./documents";
registerTool({
  name: "draft_supplier_rfq",
  module: "message_drafter",
  label: "Drafting a quote request",
  description:
    "Draft a quotation request from 1–50 saved project selections using known facts only. Returns text for review, never saves, sends, records a request or changes item statuses. Missing dimensions/specifications stay explicitly unconfirmed.",
  input: z
    .object({
      itemIds: z
        .array(z.uuid())
        .min(1)
        .max(50)
        .refine((ids) => new Set(ids).size === ids.length),
      supplierName: z.string().trim().min(1).max(200),
      recipientEmail: z.email().max(254).optional(),
      practiceName: z.string().trim().min(1).max(200),
      deadline: z.string().max(100).optional(),
    })
    .strict(),
  async run(ctx, input) {
    if (
      !getWorkflow(ctx.project).phases.some((p) =>
        p.modules.includes("message_drafter"),
      )
    )
      return {
        content: "Quote requests are not part of this workflow.",
        isError: true,
      };
    const { data } = await getDesign(
        ctx.db,
        ctx.run.workspaceId,
        ctx.project.id,
      ),
      items = input.itemIds.map((id) => data.items.find((i) => i.id === id));
    if (items.some((i) => !i))
      return {
        content: "Choose only saved selections from this project.",
        isError: true,
      };
    try {
      const request = draftRfq(
        items.filter((i) => !!i),
        {
          supplierName: input.supplierName,
          recipientEmail: input.recipientEmail ?? null,
          project: ctx.project.name,
          client: ctx.project.client,
          practice: input.practiceName,
          deadline: input.deadline,
        },
      );
      return {
        content:
          UNTRUSTED_NOTE +
          "\n" +
          JSON.stringify({
            supplier: request.supplierName,
            to: request.recipientEmail,
            subject: request.subject,
            body: request.body,
            note: "Unsaved draft. Review in Quote requests; no message has been sent.",
          }),
      };
    } catch (e) {
      return { content: (e as Error).message, isError: true };
    }
  },
});
