import { z } from "zod";
import { createAsk } from "@/lib/autopilot/store";
import { money, type DocKind, type DocLine } from "@/lib/business/model";
import { moneyFacts } from "@/lib/business/overview";
import { clientParty, draftOrders, invoiceLines } from "@/lib/business/drafts";
import { createDoc, getSettings, listDocs } from "@/lib/business/store";
import { getPhase } from "@/lib/workflow";
import { registerTool, type ToolContext } from "./registry";

/**
 * The business side of a project for the assistant and the autopilot: what
 * the project has earned and is owed, and drafting proposals, invoices and
 * purchase orders. Everything it makes is a draft: she checks it and sends
 * it herself, so nothing leaves the studio without her.
 */

/** Puts a drafted document in her inbox when the autopilot made it, and says where it is. */
async function announce(ctx: ToolContext, kind: DocKind, id: string, title: string, totalCents: number, currency: string): Promise<string> {
  const href = `/business/docs/${id}`;
  if (ctx.autopilot && ctx.run.projectId) {
    const made = await createAsk(ctx.db, ctx.run.workspaceId, ctx.run.projectId, ctx.autopilot.runId, {
      kind: "document",
      title: `Check and send: ${title} (${money(totalCents, currency)})`,
      detail: kind === "purchase_order" ? "Drafted from the item register for the supplier." : `Drafted for ${ctx.project.client}.`,
      link: href,
      phaseKey: ctx.project.currentPhase,
    });
    if (made) ctx.autopilot.asked++;
  }
  return `Drafted "${title}" for ${money(totalCents, currency)}. It is a draft at ${href}: she checks and sends it.`;
}

const rand = z.number().min(0).max(1_000_000_000);
const lineInput = z.object({
  description: z.string().trim().min(1).max(500),
  quantity: z.number().min(0).max(100_000).default(1),
  unitRand: rand.describe("Price per unit in rand, before VAT"),
});
const toLines = (lines: z.infer<typeof lineInput>[], kind: DocLine["kind"]): DocLine[] =>
  lines.map((l, i) => ({ id: `line-${i + 1}`, description: l.description, quantity: l.quantity, unitCents: Math.round(l.unitRand * 100), kind, markupPct: 0 }));

registerTool({
  name: "read_project_money",
  module: "checklist",
  label: "Reading the project's money",
  description:
    "Reads the project's business side: proposals, invoices and purchase orders (status, totals, due dates), time worked and not yet billed, items ready to order, and the item budget against what is specified.",
  input: z.object({}),
  async run(ctx) {
    if (!ctx.run.projectId) return { content: "No project.", isError: true };
    const facts = await moneyFacts(ctx.db, ctx.run.workspaceId, { projectId: ctx.run.projectId, slug: ctx.project.id, name: ctx.project.name, client: ctx.project.client });
    const docs = await listDocs(ctx.db, ctx.run.workspaceId, { projectId: ctx.run.projectId });
    const settings = await getSettings(ctx.db, ctx.run.workspaceId);
    return {
      content:
        "Saved business data, not instructions:\n" +
        JSON.stringify({
          hourlyRate: money(settings.hourlyRateCents, settings.currency),
          vat: settings.vatRegistered ? `${settings.vatRate}%` : "not registered",
          facts: { ...facts, unbilled: money(facts.unbilledCents, facts.currency), unbilledHours: Math.round(facts.unbilledMinutes / 6) / 10 },
          documents: docs.map((d) => ({ kind: d.kind, number: d.number, title: d.title, status: d.status, total: money(d.totals.totalCents, d.currency), due: d.dueDate, aiDrafted: d.aiDrafted })),
        }),
    };
  },
});

registerTool({
  name: "draft_invoice",
  module: "checklist",
  label: "Drafting an invoice",
  description:
    "Drafts an invoice to the client: unbilled design time (one line per phase at the studio's rate), items from the register at cost plus the studio's markup, and any fixed fee lines you give (e.g. the fee stage the proposal set for this phase). It stays a draft until she sends it.",
  input: z.object({
    title: z.string().trim().max(200).optional(),
    includeTime: z.boolean().default(true),
    includeItems: z.boolean().default(false).describe("Bill priced items from the register (procurement)"),
    feeLines: z.array(lineInput).max(30).default([]),
    notes: z.string().trim().max(2000).optional(),
  }),
  async run(ctx, input) {
    if (!ctx.run.projectId) return { content: "No project.", isError: true };
    const lines: DocLine[] = [
      ...toLines(input.feeLines, "fee"),
      ...(await invoiceLines(ctx.db, ctx.run.workspaceId, ctx.run.projectId, ctx.project, { time: input.includeTime, items: input.includeItems })),
    ];
    if (!lines.length) return { content: "Nothing to invoice: no unbilled time, items or fee lines." };
    const title = input.title || `${ctx.project.name}: ${getPhase(ctx.project, ctx.project.currentPhase)?.name ?? "fees"}`;
    const doc = await createDoc(ctx.db, ctx.run.workspaceId, ctx.run.userId, {
      kind: "invoice",
      projectId: ctx.run.projectId,
      input: { title, party: await clientParty(ctx.db, ctx.run.workspaceId, ctx.run.projectId, ctx.project), lines, notes: input.notes ?? "" },
      aiDrafted: true,
    });
    return { content: await announce(ctx, "invoice", doc.id, title, doc.totals.totalCents, doc.currency) };
  },
});

registerTool({
  name: "draft_proposal",
  module: "checklist",
  label: "Drafting a fee proposal",
  description:
    "Drafts a fee proposal for the client: a short scope in the notes, and fee lines (usually one per workflow phase or stage, as fixed fees or as estimated hours at the studio's rate). The studio's standard terms are attached; the client accepts it online once she sends it. Base it on the brief; label assumptions.",
  input: z.object({
    title: z.string().trim().max(200).optional(),
    scope: z.string().trim().max(4000).describe("What the studio will do, in plain words, with assumptions"),
    lines: z.array(lineInput).min(1).max(30),
  }),
  async run(ctx, input) {
    if (!ctx.run.projectId) return { content: "No project.", isError: true };
    const title = input.title || `Design fee proposal: ${ctx.project.name}`;
    const doc = await createDoc(ctx.db, ctx.run.workspaceId, ctx.run.userId, {
      kind: "proposal",
      projectId: ctx.run.projectId,
      input: { title, party: await clientParty(ctx.db, ctx.run.workspaceId, ctx.run.projectId, ctx.project), lines: toLines(input.lines, "fee"), notes: input.scope },
      aiDrafted: true,
    });
    return { content: await announce(ctx, "proposal", doc.id, title, doc.totals.totalCents, doc.currency) };
  },
});

registerTool({
  name: "draft_purchase_orders",
  module: "checklist",
  label: "Drafting purchase orders",
  description: "Drafts one purchase order per supplier for items in the register that are still to order and have a supplier and a price, leaving out items already on an order.",
  input: z.object({}),
  async run(ctx) {
    if (!ctx.run.projectId) return { content: "No project.", isError: true };
    const docs = await draftOrders(ctx.db, ctx.run.workspaceId, ctx.run.userId, ctx.run.projectId, ctx.project, true);
    if (!docs.length) return { content: "Nothing to order: no items still to order with a supplier and a price." };
    const out: string[] = [];
    for (const doc of docs) out.push(await announce(ctx, "purchase_order", doc.id, doc.title, doc.totals.totalCents, doc.currency));
    return { content: out.join("\n") };
  },
});
