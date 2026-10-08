import type { DesignData, DesignItem } from "@/lib/design/schema";
import {
  DEFAULT_RFQ_TEMPLATE,
  rfqDraftSchema,
  rfqTemplateSchema,
  type RfqDraft,
  type RfqTemplate,
} from "./schema";

/** Expand known placeholders once; source text cannot introduce extra substitutions or executable templates. */
export function draftRfq(
  items: DesignItem[],
  options: {
    supplierName: string;
    recipientEmail: string | null;
    project: string;
    client: string;
    practice: string;
    deadline?: string;
    template?: RfqTemplate;
    id?: string;
    now?: string;
  },
): RfqDraft {
  if (!items.length || items.length > 50)
    throw new Error("Select between 1 and 50 items for this request.");
  if (new Set(items.map((i) => i.id)).size !== items.length)
    throw new Error("Each item can appear only once.");
  const template = rfqTemplateSchema.parse(
    options.template ?? DEFAULT_RFQ_TEMPLATE,
  );
  const itemText = items
    .map((i, n) =>
      [
        `${n + 1}. ${i.name}`,
        `Quantity: ${i.quantity}`,
        ...(i.category ? [`Category: ${i.category}`] : []),
        `Dimensions: ${i.dimensions.trim() || "To be confirmed"}`,
        `Specification: ${i.specification.trim() || "To be confirmed"}`,
        ...(i.supplierUrl ? [`Product reference: ${i.supplierUrl}`] : []),
      ].join("\n"),
    )
    .join("\n\n");
  const values: Record<string, string> = {
    project: options.project,
    client: options.client,
    practice: options.practice,
    supplier: options.supplierName,
    deadline: options.deadline?.trim()
      ? `Requested quote deadline: ${options.deadline.trim()}`
      : "Please confirm when you can provide a quote.",
    items: itemText,
  };
  const fill = (value: string) =>
    value.replace(
      /\{(project|client|supplier|practice|deadline|items)\}/g,
      (_m, key: string) => values[key],
    );
  const parsed = rfqDraftSchema.safeParse({
    id: options.id ?? crypto.randomUUID(),
    supplierName: options.supplierName,
    recipientEmail: options.recipientEmail,
    subject: fill(template.subject),
    body: fill(template.body),
    itemIds: items.map((i) => i.id),
    createdAt: options.now ?? new Date().toISOString(),
    requestedAt: null,
  });
  if (!parsed.success)
    throw new Error(
      parsed.error.issues[0].path.includes("body")
        ? "This request is too long. Select fewer items; specifications are never shortened silently."
        : parsed.error.issues[0].message,
    );
  return parsed.data;
}
export function saveRfq(data: DesignData, draft: RfqDraft): DesignData {
  const checked = rfqDraftSchema.parse(draft),
    existing = data.rfqs ?? [];
  const previous = existing.find((r) => r.id === draft.id);
  if (
    previous?.requestedAt &&
    JSON.stringify(previous) !== JSON.stringify(checked)
  )
    throw new Error(
      "A recorded request cannot be edited. Create a new draft instead.",
    );
  if (!existing.some((r) => r.id === draft.id) && existing.length >= 20)
    throw new Error(
      "This project has 20 saved requests. Remove an unused draft first.",
    );
  return {
    ...data,
    rfqs: existing.some((r) => r.id === draft.id)
      ? existing.map((r) => (r.id === draft.id ? checked : r))
      : [checked, ...existing],
  };
}
/** Recording an external request never sends a message or moves ordered/delivered items backwards. */
export function recordRfqRequested(
  data: DesignData,
  id: string,
  now = new Date().toISOString(),
): DesignData {
  const request = data.rfqs?.find((r) => r.id === id);
  if (!request) throw new Error("Choose a saved quote request.");
  if (request.requestedAt) return data;
  const ids = new Set(request.itemIds);
  const recorded = rfqDraftSchema.parse({ ...request, requestedAt: now });
  return {
    ...data,
    rfqs: data.rfqs!.map((r) => (r.id === id ? recorded : r)),
    items: data.items.map((i) =>
      ids.has(i.id) && i.status === "needs_sourcing"
        ? { ...i, status: "quote_requested" }
        : i,
    ),
  };
}
