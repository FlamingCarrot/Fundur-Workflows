import { z } from "zod";

/**
 * Running the studio as a business: what it charges and how (settings), time
 * spent, proposals, invoices and purchase orders, and enquiries. This file
 * needs no database: the shapes, the sums and the drafts worked out from
 * time and items, so the screens, the server and the AI all agree.
 *
 * Money is whole cents of the studio's currency (rand by default). VAT is
 * charged only when the studio says it is VAT registered.
 */

const cents = z.number().int().min(0).max(100_000_000_000);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** A plain starting point for a studio's proposal terms; the studio edits them (and should have an attorney check them). */
export const DEFAULT_PROPOSAL_TERMS = `1. Scope. The studio provides the services set out in this proposal. Work outside it is quoted separately before it starts.
2. Fees. Fees are as listed, excluding VAT where VAT applies, and are invoiced at the end of each stage. Invoices are payable within the days shown on them.
3. Changes. Changes to an approved stage are charged at the studio's hourly rate.
4. Purchases. Furniture, finishes and contractors are quoted separately. Orders are placed once the client approves and pays the deposit the supplier requires.
5. Designs. The studio keeps the copyright in its drawings and designs; the client may use them for this project.
6. Ending. Either party may end the agreement in writing. Work done up to then is payable.
7. Personal information. The studio uses the client's personal information only for this project, as the Protection of Personal Information Act requires.
8. Law. South African law applies. Accepting this proposal online, by typing your name, is your signature.`;

export const businessSettings = z.object({
  studioName: z.string().trim().max(200).default(""),
  address: z.string().trim().max(1000).default(""),
  email: z.string().trim().max(254).default(""),
  phone: z.string().trim().max(50).default(""),
  registration: z.string().trim().max(100).default(""),
  vatRegistered: z.boolean().default(false),
  vatNumber: z.string().trim().max(50).default(""),
  vatRate: z.number().min(0).max(50).default(15),
  currency: z.string().regex(/^[A-Z]{3}$/).default("ZAR"),
  /** What an hour of design time is billed at. */
  hourlyRateCents: cents.default(85_000),
  /** Added to supplier prices when items are invoiced to the client. */
  defaultMarkupPct: z.number().min(0).max(500).default(20),
  paymentTermsDays: z.number().int().min(0).max(180).default(14),
  bankDetails: z.string().trim().max(1000).default(""),
  /** Standard terms printed on proposals; the client accepts them with the proposal. */
  proposalTerms: z.string().trim().max(10_000).default(DEFAULT_PROPOSAL_TERMS),
  invoicePrefix: z.string().trim().max(10).default("INV-"),
  proposalPrefix: z.string().trim().max(10).default("PRO-"),
  orderPrefix: z.string().trim().max(10).default("PO-"),
});
export type BusinessSettings = z.infer<typeof businessSettings>;
export const DEFAULT_SETTINGS: BusinessSettings = businessSettings.parse({});

export const DOC_KINDS = ["proposal", "invoice", "purchase_order"] as const;
export type DocKind = (typeof DOC_KINDS)[number];
export const DOC_STATUSES = ["draft", "sent", "accepted", "declined", "paid", "void"] as const;
export type DocStatus = (typeof DOC_STATUSES)[number];

export const KIND_LABEL: Record<DocKind, string> = { proposal: "Proposal", invoice: "Invoice", purchase_order: "Purchase order" };

export const docLine = z.object({
  id: z.string().min(1).max(60),
  description: z.string().trim().min(1).max(500),
  quantity: z.number().min(0).max(1_000_000),
  /** Per unit, before markup and VAT. */
  unitCents: cents,
  kind: z.enum(["fee", "time", "item", "expense"]).default("fee"),
  markupPct: z.number().min(0).max(500).default(0),
  /** The item in the project's register it is for, when it is one. */
  itemId: z.string().max(60).optional(),
  /** Time entries billed on this line. */
  timeEntryIds: z.array(z.string().max(60)).max(500).optional(),
  /** The expense recharged on this line. */
  expenseId: z.string().max(60).optional(),
});
export type DocLine = z.infer<typeof docLine>;

export const party = z.object({
  name: z.string().trim().max(255).default(""),
  email: z.string().trim().max(254).default(""),
  address: z.string().trim().max(1000).default(""),
  vatNumber: z.string().trim().max(50).default(""),
});
export type Party = z.infer<typeof party>;

export const docInput = z.object({
  title: z.string().trim().max(200).default(""),
  party: party.default({ name: "", email: "", address: "", vatNumber: "" }),
  lines: z.array(docLine).max(300).default([]),
  notes: z.string().trim().max(5000).default(""),
  terms: z.string().trim().max(10_000).default(""),
  issueDate: day.nullable().default(null),
  dueDate: day.nullable().default(null),
});
export type DocInput = z.infer<typeof docInput>;

export interface BusinessDoc extends DocInput {
  id: string;
  kind: DocKind;
  status: DocStatus;
  number: string | null;
  projectId: string | null;
  projectSlug: string | null;
  projectName: string | null;
  leadId: string | null;
  vatRate: number;
  currency: string;
  totals: Totals;
  paidCents: number;
  sentAt: string | null;
  acceptedAt: string | null;
  acceptedName: string | null;
  paidAt: string | null;
  aiDrafted: boolean;
  /** When the autopilot last drafted a payment reminder for it. */
  remindedAt: string | null;
  /** The client's link, while one exists. */
  link: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Totals {
  subtotalCents: number;
  vatCents: number;
  totalCents: number;
}

export function lineCents(l: Pick<DocLine, "quantity" | "unitCents" | "markupPct">): number {
  return Math.round(l.quantity * l.unitCents * (1 + (l.markupPct ?? 0) / 100));
}

export function totals(lines: DocLine[], vatRate: number): Totals {
  const subtotalCents = lines.reduce((s, l) => s + lineCents(l), 0);
  const vatCents = Math.round((subtotalCents * vatRate) / 100);
  return { subtotalCents, vatCents, totalCents: subtotalCents + vatCents };
}

/** The VAT rate a new document carries: the studio's, or none when it is not registered. */
export const docVatRate = (s: BusinessSettings) => (s.vatRegistered ? s.vatRate : 0);

export function money(cents: number, currency = "ZAR"): string {
  const value = cents / 100;
  if (currency === "ZAR") return `R${value.toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return value.toLocaleString("en-ZA", { style: "currency", currency });
}

export const hours = (minutes: number) => Math.round((minutes / 60) * 100) / 100;

export function addDays(dayStr: string, n: number): string {
  const d = new Date(`${dayStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Overdue: sent, not paid, and past its due day. */
export function isOverdue(doc: Pick<BusinessDoc, "kind" | "status" | "dueDate">, today: string): boolean {
  return doc.kind === "invoice" && doc.status === "sent" && !!doc.dueDate && doc.dueDate < today;
}

// ---------------------------------------------------------------- time

export interface TimeEntry {
  id: string;
  projectId: string | null;
  projectSlug: string | null;
  projectName: string | null;
  userId: string;
  phaseKey: string | null;
  note: string;
  startedAt: string;
  endedAt: string | null;
  minutes: number;
  billable: boolean;
  rateCents: number | null;
  invoiceId: string | null;
}

/** Minutes a running timer has run so far, or a stopped entry's minutes. */
export function entryMinutes(e: Pick<TimeEntry, "startedAt" | "endedAt" | "minutes">, now = Date.now()): number {
  if (e.endedAt) return e.minutes;
  return Math.max(0, Math.round((now - new Date(e.startedAt).getTime()) / 60_000));
}

/**
 * Invoice lines for unbilled, billable time: one line per phase, in hours at
 * the entry's rate (else the studio's), carrying the entries it bills.
 */
export function timeLines(entries: TimeEntry[], settings: BusinessSettings, phaseName: (key: string | null) => string): DocLine[] {
  const groups = new Map<string, TimeEntry[]>();
  for (const e of entries) {
    if (!e.billable || e.invoiceId || !e.endedAt || e.minutes <= 0) continue;
    const key = `${e.phaseKey ?? ""}|${e.rateCents ?? settings.hourlyRateCents}`;
    groups.set(key, [...(groups.get(key) ?? []), e]);
  }
  return [...groups.entries()].map(([key, list], i) => {
    const [phaseKey, rate] = key.split("|");
    const minutes = list.reduce((s, e) => s + e.minutes, 0);
    return {
      id: `time-${i + 1}`,
      description: `Design time: ${phaseName(phaseKey || null)} (${hours(minutes)} h)`,
      quantity: hours(minutes),
      unitCents: Number(rate),
      kind: "time" as const,
      markupPct: 0,
      timeEntryIds: list.map((e) => e.id),
    };
  });
}

/** Items from the register, as lines, at the supplier price plus markup. */
export interface RegisterItem {
  id: string;
  name: string;
  quantity: number;
  unitPriceCents: number | null;
  supplier: string;
  status: string;
}

export function itemLines(items: RegisterItem[], markupPct: number): DocLine[] {
  return items
    .filter((i) => i.unitPriceCents != null)
    .map((i) => ({
      id: `item-${i.id}`,
      description: i.name + (i.supplier ? ` (${i.supplier})` : ""),
      quantity: i.quantity,
      unitCents: i.unitPriceCents!,
      kind: "item" as const,
      markupPct,
      itemId: i.id,
    }));
}

/** One purchase order per supplier, for items still to order that have a supplier and a price. */
export function purchaseOrderDrafts(items: RegisterItem[]): { supplier: string; lines: DocLine[] }[] {
  const bySupplier = new Map<string, RegisterItem[]>();
  for (const i of items) {
    if (!i.supplier.trim() || i.unitPriceCents == null || !["needs_sourcing", "quote_requested"].includes(i.status)) continue;
    bySupplier.set(i.supplier.trim(), [...(bySupplier.get(i.supplier.trim()) ?? []), i]);
  }
  return [...bySupplier.entries()].map(([supplier, list]) => ({
    supplier,
    lines: list.map((i) => ({ id: `item-${i.id}`, description: i.name, quantity: i.quantity, unitCents: i.unitPriceCents!, kind: "item" as const, markupPct: 0, itemId: i.id })),
  }));
}

// ---------------------------------------------------------------- leads

export const LEAD_STATUSES = ["new", "contacted", "proposal", "won", "lost"] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];
export const LEAD_STATUS_LABEL: Record<LeadStatus, string> = { new: "New", contacted: "Contacted", proposal: "Proposal sent", won: "Won", lost: "Lost" };

export const enquiryInput = z.object({
  name: z.string().trim().min(1).max(200),
  email: z.string().trim().email().max(254),
  phone: z.string().trim().max(50).default(""),
  company: z.string().trim().max(200).default(""),
  budget: z.string().trim().max(100).default(""),
  message: z.string().trim().min(1).max(5000),
  /** A trap field people never see; bots fill it in. */
  website: z.string().max(0).optional(),
});
export type EnquiryInput = z.infer<typeof enquiryInput>;

export interface Lead {
  id: string;
  name: string;
  email: string;
  phone: string;
  company: string;
  budget: string;
  message: string;
  source: "form" | "manual";
  status: LeadStatus;
  notes: string;
  /** A reply the AI drafted for her to check and send; null until one is written. */
  draftReply: string | null;
  projectSlug: string | null;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------- the picture

export interface ProjectMoney {
  projectId: string;
  slug: string;
  name: string;
  client: string;
  minutes: number;
  unbilledMinutes: number;
  unbilledCents: number;
  proposedCents: number;
  acceptedCents: number;
  invoicedCents: number;
  paidCents: number;
  outstandingCents: number;
  overdueCents: number;
  /** Fees earned per hour worked, once anything has been invoiced. */
  effectiveRateCents: number | null;
  itemBudgetCents: number | null;
  itemSpecCents: number;
}

export function projectMoney(
  p: { projectId: string; slug: string; name: string; client: string },
  docs: BusinessDoc[],
  entries: TimeEntry[],
  settings: BusinessSettings,
  design: { budgetCents: number | null; items: RegisterItem[] } | null,
  today: string
): ProjectMoney {
  const mine = docs.filter((d) => d.projectId === p.projectId && d.status !== "void");
  const time = entries.filter((e) => e.projectId === p.projectId);
  const minutes = time.reduce((s, e) => s + (e.endedAt ? e.minutes : 0), 0);
  const unbilled = time.filter((e) => e.billable && !e.invoiceId && e.endedAt);
  const unbilledMinutes = unbilled.reduce((s, e) => s + e.minutes, 0);
  const unbilledCents = unbilled.reduce((s, e) => s + Math.round((e.minutes / 60) * (e.rateCents ?? settings.hourlyRateCents)), 0);
  const sum = (list: BusinessDoc[]) => list.reduce((s, d) => s + d.totals.totalCents, 0);
  const invoices = mine.filter((d) => d.kind === "invoice" && d.status !== "draft");
  const invoicedCents = sum(invoices);
  const paidCents = invoices.reduce((s, d) => s + (d.status === "paid" ? d.totals.totalCents : d.paidCents), 0);
  const fees = invoices.reduce((s, d) => s + d.lines.filter((l) => l.kind !== "item" && l.kind !== "expense").reduce((a, l) => a + lineCents(l), 0), 0);
  return {
    ...p,
    minutes,
    unbilledMinutes,
    unbilledCents,
    proposedCents: sum(mine.filter((d) => d.kind === "proposal" && d.status === "sent")),
    acceptedCents: sum(mine.filter((d) => d.kind === "proposal" && d.status === "accepted")),
    invoicedCents,
    paidCents,
    outstandingCents: invoicedCents - paidCents,
    overdueCents: invoices.filter((d) => isOverdue(d, today)).reduce((s, d) => s + d.totals.totalCents - d.paidCents, 0),
    effectiveRateCents: fees > 0 && minutes > 0 ? Math.round(fees / (minutes / 60)) : null,
    itemBudgetCents: design?.budgetCents ?? null,
    itemSpecCents: (design?.items ?? []).reduce((s, i) => s + (i.unitPriceCents == null ? 0 : Math.round(i.unitPriceCents * i.quantity)), 0),
  };
}

/** Money spent for a project, recharged to the client with any markup. */
export interface Expense {
  id: string;
  projectId: string | null;
  projectSlug: string | null;
  projectName: string | null;
  userId: string;
  spentOn: string;
  description: string;
  amountCents: number;
  markupPct: number;
  billable: boolean;
  invoiceId: string | null;
}

export const expenseInput = z.object({
  spentOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  description: z.string().trim().min(1).max(500),
  amountCents: z.number().int().min(1).max(100_000_000_000),
  markupPct: z.number().min(0).max(500).default(0),
  billable: z.boolean().default(true),
});

/** Unbilled, billable expenses as invoice lines, one each. */
export function expenseLines(expenses: Expense[]): DocLine[] {
  return expenses
    .filter((e) => e.billable && !e.invoiceId)
    .map((e) => ({ id: `exp-${e.id}`, description: `${e.description} (${e.spentOn})`, quantity: 1, unitCents: e.amountCents, kind: "expense" as const, markupPct: e.markupPct, expenseId: e.id }));
}
