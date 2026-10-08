import { z } from "zod";
const https = z
  .string()
  .max(2000)
  .url()
  .refine((v) => new URL(v).protocol === "https:", "Use an HTTPS website link")
  .nullable();
export const supplierSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    contactName: z.string().max(200),
    email: z.email().max(254).nullable(),
    phone: z.string().max(100),
    website: https,
    notes: z.string().max(2000),
  })
  .strict();
const tokens = new Set([
  "project",
  "client",
  "supplier",
  "practice",
  "deadline",
  "items",
]);
function knownTokens(value: string) {
  return [...value.matchAll(/\{([^{}]+)\}/g)].every((m) => tokens.has(m[1]));
}
export const rfqTemplateSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    subject: z
      .string()
      .trim()
      .min(1)
      .max(500)
      .refine(knownTokens, "Use only the listed placeholders")
      .refine((v) => !v.includes("{items}"), "Put the item list in the body"),
    body: z
      .string()
      .trim()
      .min(1)
      .max(8000)
      .refine(knownTokens, "Use only the listed placeholders")
      .refine(
        (v) => v.includes("{items}"),
        "Include {items} in the template body",
      ),
  })
  .strict();
export const sourcingEntryInput = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("supplier"),
      id: z.uuid().optional(),
      data: supplierSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("template"),
      id: z.uuid().optional(),
      data: rfqTemplateSchema,
    })
    .strict(),
]);
export type Supplier = z.infer<typeof supplierSchema>;
export type RfqTemplate = z.infer<typeof rfqTemplateSchema>;
export type SourcingEntryInput = z.infer<typeof sourcingEntryInput>;
export type SourcingEntry = SourcingEntryInput & {
  id: string;
  createdAt: string;
};
export const rfqDraftSchema = z
  .object({
    id: z.uuid(),
    supplierName: z.string().trim().min(1).max(200),
    recipientEmail: z.email().max(254).nullable(),
    subject: z.string().trim().min(1).max(500),
    body: z.string().trim().min(1).max(60_000),
    itemIds: z
      .array(z.uuid())
      .min(1)
      .max(50)
      .refine(
        (ids) => new Set(ids).size === ids.length,
        "Each item appears once",
      ),
    createdAt: z.iso.datetime(),
    requestedAt: z.iso.datetime().nullable(),
  })
  .strict();
export type RfqDraft = z.infer<typeof rfqDraftSchema>;
export const blankSupplier = (): Supplier => ({
  name: "",
  contactName: "",
  email: null,
  phone: "",
  website: null,
  notes: "",
});
export const DEFAULT_RFQ_TEMPLATE: RfqTemplate = {
  name: "Standard quotation request",
  subject: "{project} — request for quotation",
  body: "Hello {supplier},\n\nPlease quote for the following selections for {project} ({client}):\n\n{items}\n\nPlease include unit and line totals, currency, VAT/tax basis, delivery and installation costs, availability, lead times, and how long the quote is valid. Identify any substitutions or missing information before pricing.\n\n{deadline}\n\nThank you,\n{practice}",
};
