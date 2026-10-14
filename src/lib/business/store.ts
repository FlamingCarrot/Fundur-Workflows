import { randomBytes } from "node:crypto";
import type { Db } from "@/lib/db";
import { decryptSecret, encryptSecret } from "@/lib/server/secrets";
import { tokenHash, validToken } from "@/lib/workspaces/store";
import {
  addDays,
  businessSettings,
  DEFAULT_SETTINGS,
  docInput,
  docVatRate,
  enquiryInput,
  totals,
  type BusinessDoc,
  type BusinessSettings,
  type DocInput,
  type DocKind,
  type DocStatus,
  type EnquiryInput,
  type Lead,
  type LeadStatus,
  type TimeEntry,
  type Expense,
  expenseInput,
} from "./model";

/** The studio's business records: settings, time, documents and leads. */

export class BusinessError extends Error {
  constructor(message: string, public readonly status = 400) {
    super(message);
  }
}

const newToken = () => randomBytes(32).toString("base64url");
const iso = (v: unknown) => (v == null ? null : new Date(v as string).toISOString());
const dayOf = (v: unknown) => (v == null ? null : typeof v === "string" ? v.slice(0, 10) : new Date(v as Date).toISOString().slice(0, 10));
const json = <T>(v: unknown, fallback: T): T => (v == null ? fallback : typeof v === "string" ? (JSON.parse(v) as T) : (v as T));
const today = () => new Date().toISOString().slice(0, 10);

// ---------------------------------------------------------------- settings

export async function getSettings(db: Db, workspaceId: string): Promise<BusinessSettings> {
  const [row] = await db.query<{ settings: unknown }>("SELECT settings FROM business_settings WHERE workspace_id = $1", [workspaceId]);
  const parsed = businessSettings.safeParse(json(row?.settings, {}));
  return parsed.success ? parsed.data : DEFAULT_SETTINGS;
}

export async function saveSettings(db: Db, workspaceId: string, userId: string, patch: Partial<BusinessSettings>): Promise<BusinessSettings> {
  const next = businessSettings.parse({ ...(await getSettings(db, workspaceId)), ...patch });
  await db.query(
    `INSERT INTO business_settings (workspace_id, settings, updated_by) VALUES ($1, $2::jsonb, $3)
     ON CONFLICT (workspace_id) DO UPDATE SET settings = EXCLUDED.settings, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
    [workspaceId, JSON.stringify(next), userId]
  );
  return next;
}

/** The enquiry form's token, made the first time it is asked for (or anew when `reset`). */
export async function enquiryToken(db: Db, workspaceId: string, reset = false): Promise<string> {
  const [row] = await db.query<{ enquiry_token_sealed: string | null }>("SELECT enquiry_token_sealed FROM business_settings WHERE workspace_id = $1", [workspaceId]);
  if (row?.enquiry_token_sealed && !reset) return decryptSecret(row.enquiry_token_sealed);
  const token = newToken();
  await db.query(
    `INSERT INTO business_settings (workspace_id, enquiry_token_hash, enquiry_token_sealed) VALUES ($1, $2, $3)
     ON CONFLICT (workspace_id) DO UPDATE SET enquiry_token_hash = EXCLUDED.enquiry_token_hash, enquiry_token_sealed = EXCLUDED.enquiry_token_sealed`,
    [workspaceId, tokenHash(token), encryptSecret(token)]
  );
  return token;
}

/** The studio an enquiry link belongs to, with what the form shows; null for a wrong link. */
export async function enquiryStudio(db: Db, token: string): Promise<{ workspaceId: string; studioName: string } | null> {
  if (!validToken(token)) return null;
  const [row] = await db.query<{ workspace_id: string; settings: unknown; name: string }>(
    "SELECT b.workspace_id, b.settings, w.name FROM business_settings b JOIN workspaces w ON w.id = b.workspace_id WHERE b.enquiry_token_hash = $1",
    [tokenHash(token)]
  );
  if (!row) return null;
  const s = businessSettings.safeParse(json(row.settings, {}));
  return { workspaceId: row.workspace_id, studioName: (s.success && s.data.studioName) || row.name };
}

// ---------------------------------------------------------------- leads

function toLead(r: Record<string, unknown>): Lead {
  return {
    id: String(r.id),
    name: String(r.name),
    email: String(r.email ?? ""),
    phone: String(r.phone ?? ""),
    company: String(r.company ?? ""),
    budget: String(r.budget ?? ""),
    message: String(r.message ?? ""),
    source: r.source === "form" ? "form" : "manual",
    status: r.status as LeadStatus,
    notes: String(r.notes ?? ""),
    draftReply: (r.draft_reply as string) ?? null,
    projectSlug: (r.slug as string) ?? null,
    createdAt: iso(r.created_at)!,
    updatedAt: iso(r.updated_at)!,
  };
}

/** Whether this person owns the workspace: the studio's money is theirs alone. */
export async function isOwner(db: Db, workspaceId: string, userId: string): Promise<boolean> {
  const [row] = await db.query<{ role: string }>("SELECT role FROM memberships WHERE workspace_id = $1 AND user_id = $2", [workspaceId, userId]);
  return row?.role === "owner";
}

/** The autopilot drafted a payment reminder for these invoices; it waits a week before the next. */
export async function markReminded(db: Db, workspaceId: string, ids: string[]): Promise<void> {
  if (ids.length) await db.query("UPDATE business_docs SET reminded_at = NOW() WHERE workspace_id = $1 AND id = ANY($2::uuid[])", [workspaceId, ids]);
}

export async function addLead(db: Db, workspaceId: string, input: EnquiryInput, source: "form" | "manual"): Promise<Lead> {
  const e = enquiryInput.parse(input);
  if (source === "form") {
    // A burst from one address is one enquiry.
    const [recent] = await db.query<{ n: string | number }>(
      "SELECT COUNT(*) AS n FROM leads WHERE workspace_id = $1 AND lower(email) = lower($2) AND created_at > NOW() - INTERVAL '10 minutes'",
      [workspaceId, e.email]
    );
    if (Number(recent?.n ?? 0) >= 3) throw new BusinessError("Thanks, we already have your message.", 429);
    // A flood from many addresses is a bot, not clients.
    const [hour] = await db.query<{ n: string | number }>("SELECT COUNT(*) AS n FROM leads WHERE workspace_id = $1 AND source = 'form' AND created_at > NOW() - INTERVAL '1 hour'", [workspaceId]);
    if (Number(hour?.n ?? 0) >= 30) throw new BusinessError("The studio is getting a lot of enquiries right now. Please try again later.", 429);
  }
  const [row] = await db.query<Record<string, unknown>>(
    `INSERT INTO leads (workspace_id, name, email, phone, company, budget, message, source) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
    [workspaceId, e.name, e.email, e.phone, e.company, e.budget, e.message, source]
  );
  return toLead(row);
}

export async function listLeads(db: Db, workspaceId: string): Promise<Lead[]> {
  const rows = await db.query<Record<string, unknown>>(
    "SELECT l.*, p.slug FROM leads l LEFT JOIN projects p ON p.id = l.project_id WHERE l.workspace_id = $1 ORDER BY l.created_at DESC LIMIT 500",
    [workspaceId]
  );
  return rows.map(toLead);
}

export async function getLead(db: Db, workspaceId: string, id: string): Promise<Lead | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [row] = await db.query<Record<string, unknown>>(
    "SELECT l.*, p.slug FROM leads l LEFT JOIN projects p ON p.id = l.project_id WHERE l.workspace_id = $1 AND l.id = $2",
    [workspaceId, id]
  );
  return row ? toLead(row) : null;
}

export async function updateLead(db: Db, workspaceId: string, id: string, patch: { status?: LeadStatus; notes?: string; projectId?: string }): Promise<Lead | null> {
  await db.query(
    `UPDATE leads SET status = COALESCE($3, status), notes = COALESCE($4, notes), project_id = COALESCE($5, project_id), updated_at = NOW() WHERE workspace_id = $1 AND id = $2`,
    [workspaceId, id, patch.status ?? null, patch.notes ?? null, patch.projectId ?? null]
  );
  return getLead(db, workspaceId, id);
}

// ---------------------------------------------------------------- documents

function toDoc(r: Record<string, unknown>, origin?: string): BusinessDoc {
  const lines = json(r.lines, []);
  const vatRate = Number(r.vat_rate ?? 0);
  const sealed = r.token_sealed as string | null;
  return {
    id: String(r.id),
    kind: r.kind as DocKind,
    status: r.status as DocStatus,
    number: (r.number as string) ?? null,
    projectId: (r.project_id as string) ?? null,
    projectSlug: (r.slug as string) ?? null,
    projectName: (r.project_name as string) ?? null,
    leadId: (r.lead_id as string) ?? null,
    title: String(r.title ?? ""),
    party: { name: "", email: "", address: "", vatNumber: "", ...json(r.party, {}) },
    lines,
    notes: String(r.notes ?? ""),
    terms: String(r.terms ?? ""),
    issueDate: dayOf(r.issue_date),
    dueDate: dayOf(r.due_date),
    vatRate,
    currency: String(r.currency ?? "ZAR"),
    totals: totals(lines, vatRate),
    paidCents: Number(r.paid_cents ?? 0),
    sentAt: iso(r.sent_at),
    acceptedAt: iso(r.accepted_at),
    acceptedName: (r.accepted_name as string) ?? null,
    paidAt: iso(r.paid_at),
    aiDrafted: !!r.ai_drafted,
    remindedAt: iso(r.reminded_at),
    link: sealed && origin !== undefined ? `${origin}/d/${decryptSecret(sealed)}` : null,
    createdAt: iso(r.created_at)!,
    updatedAt: iso(r.updated_at)!,
  };
}

const DOC_SELECT = `SELECT d.*, p.slug, p.name AS project_name FROM business_docs d LEFT JOIN projects p ON p.id = d.project_id`;

export async function listDocs(db: Db, workspaceId: string, opts: { kind?: DocKind; projectId?: string; origin?: string } = {}): Promise<BusinessDoc[]> {
  const where = ["d.workspace_id = $1"];
  const params: unknown[] = [workspaceId];
  if (opts.kind) where.push(`d.kind = $${params.push(opts.kind)}`);
  if (opts.projectId) where.push(`d.project_id = $${params.push(opts.projectId)}`);
  const rows = await db.query<Record<string, unknown>>(`${DOC_SELECT} WHERE ${where.join(" AND ")} ORDER BY d.created_at DESC LIMIT 1000`, params);
  return rows.map((r) => toDoc(r, opts.origin));
}

export async function getDoc(db: Db, workspaceId: string, id: string, origin?: string): Promise<BusinessDoc | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [row] = await db.query<Record<string, unknown>>(`${DOC_SELECT} WHERE d.workspace_id = $1 AND d.id = $2`, [workspaceId, id]);
  return row ? toDoc(row, origin) : null;
}

export interface NewDoc {
  kind: DocKind;
  projectId?: string | null;
  leadId?: string | null;
  input: Partial<DocInput>;
  aiDrafted?: boolean;
}

/** A new draft, with the studio's VAT, terms and payment days filled in. */
export async function createDoc(db: Db, workspaceId: string, userId: string, doc: NewDoc): Promise<BusinessDoc> {
  const settings = await getSettings(db, workspaceId);
  const input = docInput.parse({
    ...doc.input,
    terms: doc.input.terms ?? (doc.kind === "proposal" ? settings.proposalTerms : ""),
  });
  const timeIds = input.lines.flatMap((l) => l.timeEntryIds ?? []);
  if (timeIds.length) {
    const taken = await db.query("SELECT id FROM time_entries WHERE workspace_id = $1 AND id = ANY($2::uuid[]) AND invoice_id IS NOT NULL", [workspaceId, timeIds]);
    if (taken.length) throw new BusinessError("Some of that time is already on another invoice");
  }
  const expenseIds = input.lines.flatMap((l) => (l.expenseId ? [l.expenseId] : []));
  if (expenseIds.length) {
    const taken = await db.query("SELECT id FROM business_expenses WHERE workspace_id = $1 AND id = ANY($2::uuid[]) AND invoice_id IS NOT NULL", [workspaceId, expenseIds]);
    if (taken.length) throw new BusinessError("Some of those expenses are already on another invoice");
  }
  const vat = docVatRate(settings);
  const [row] = await db.query<{ id: string }>(
    `INSERT INTO business_docs (workspace_id, project_id, lead_id, kind, title, party, lines, notes, terms, vat_rate, currency, issue_date, due_date, total_cents, ai_drafted, created_by)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9, $10, $11, $12, $13, $14, $15, $16) RETURNING id`,
    [
      workspaceId,
      doc.projectId ?? null,
      doc.leadId ?? null,
      doc.kind,
      input.title,
      JSON.stringify(input.party),
      JSON.stringify(input.lines),
      input.notes,
      input.terms,
      vat,
      settings.currency,
      input.issueDate,
      input.dueDate,
      totals(input.lines, vat).totalCents,
      !!doc.aiDrafted,
      userId,
    ]
  );
  if (timeIds.length && doc.kind === "invoice") await db.query("UPDATE time_entries SET invoice_id = $3 WHERE workspace_id = $1 AND id = ANY($2::uuid[])", [workspaceId, timeIds, row.id]);
  if (expenseIds.length && doc.kind === "invoice") await db.query("UPDATE business_expenses SET invoice_id = $3 WHERE workspace_id = $1 AND id = ANY($2::uuid[])", [workspaceId, expenseIds, row.id]);
  return (await getDoc(db, workspaceId, row.id))!;
}

/** Changes a draft. Sent documents are fixed; void one and make another instead. */
export async function updateDoc(db: Db, workspaceId: string, id: string, patch: Partial<DocInput>): Promise<BusinessDoc> {
  const doc = await getDoc(db, workspaceId, id);
  if (!doc) throw new BusinessError("Not found", 404);
  if (doc.status !== "draft") throw new BusinessError("It has been sent, so it can't change. Void it and make a new one.");
  const input = docInput.parse({ ...doc, ...patch });
  const keep = new Set(input.lines.flatMap((l) => l.timeEntryIds ?? []));
  await db.query(
    `UPDATE business_docs SET title = $3, party = $4::jsonb, lines = $5::jsonb, notes = $6, terms = $7, issue_date = $8, due_date = $9, total_cents = $10, updated_at = NOW()
     WHERE workspace_id = $1 AND id = $2`,
    [workspaceId, id, input.title, JSON.stringify(input.party), JSON.stringify(input.lines), input.notes, input.terms, input.issueDate, input.dueDate, totals(input.lines, doc.vatRate).totalCents]
  );
  // Time taken off the invoice is unbilled again.
  await db.query("UPDATE time_entries SET invoice_id = NULL WHERE workspace_id = $1 AND invoice_id = $2 AND NOT (id = ANY($3::uuid[]))", [workspaceId, id, [...keep]]);
  const keepExpenses = input.lines.flatMap((l) => (l.expenseId ? [l.expenseId] : []));
  await db.query("UPDATE business_expenses SET invoice_id = NULL WHERE workspace_id = $1 AND invoice_id = $2 AND NOT (id = ANY($3::uuid[]))", [workspaceId, id, keepExpenses]);
  return (await getDoc(db, workspaceId, id))!;
}

/** Her inbox's "check and send" for a document is done once she sends, deletes or voids it. */
async function closeDocAsks(db: Db, workspaceId: string, docId: string, answer: string): Promise<void> {
  await db.query(
    "UPDATE autopilot_asks SET status = 'answered', answer = $3, answered_at = NOW(), used_at = NOW() WHERE workspace_id = $1 AND link = $2 AND status = 'open'",
    [workspaceId, `/business/docs/${docId}`, answer]
  );
}

export async function deleteDraft(db: Db, workspaceId: string, id: string): Promise<void> {
  const doc = await getDoc(db, workspaceId, id);
  if (!doc) throw new BusinessError("Not found", 404);
  if (doc.status !== "draft") throw new BusinessError("Only drafts can be deleted; void a sent one instead.");
  await db.query("UPDATE time_entries SET invoice_id = NULL WHERE workspace_id = $1 AND invoice_id = $2", [workspaceId, id]);
  await db.query("UPDATE business_expenses SET invoice_id = NULL WHERE workspace_id = $1 AND invoice_id = $2", [workspaceId, id]);
  await db.query("DELETE FROM business_docs WHERE workspace_id = $1 AND id = $2", [workspaceId, id]);
  await closeDocAsks(db, workspaceId, id, "Deleted");
}

async function nextNumber(db: Db, workspaceId: string, kind: DocKind, settings: BusinessSettings): Promise<string> {
  const prefix = kind === "invoice" ? settings.invoicePrefix : kind === "proposal" ? settings.proposalPrefix : settings.orderPrefix;
  const [row] = await db.query<{ n: string | number }>("SELECT COUNT(*) AS n FROM business_docs WHERE workspace_id = $1 AND kind = $2 AND number IS NOT NULL", [workspaceId, kind]);
  return `${prefix}${String(Number(row?.n ?? 0) + 1).padStart(4, "0")}`;
}

/**
 * Marks it sent: it gets its number, its issue and due days, and a link the
 * client (or supplier) opens without signing in. Returns it with the link.
 * Sending again keeps the number and makes no new link.
 */
export async function markSent(db: Db, workspaceId: string, id: string, origin: string): Promise<BusinessDoc> {
  const doc = await getDoc(db, workspaceId, id);
  if (!doc) throw new BusinessError("Not found", 404);
  if (doc.status === "void") throw new BusinessError("It was voided");
  if (!doc.lines.length) throw new BusinessError("Add at least one line first");
  if (doc.status === "draft") {
    const settings = await getSettings(db, workspaceId);
    const issue = doc.issueDate ?? today();
    const due = doc.dueDate ?? (doc.kind === "invoice" ? addDays(issue, settings.paymentTermsDays) : doc.kind === "proposal" ? addDays(issue, 30) : null);
    const token = newToken();
    for (let attempt = 0; ; attempt++) {
      try {
        await db.query(
          `UPDATE business_docs SET status = 'sent', number = $3, issue_date = $4, due_date = $5, sent_at = NOW(), token_hash = $6, token_sealed = $7, updated_at = NOW()
           WHERE workspace_id = $1 AND id = $2 AND status = 'draft'`,
          [workspaceId, id, await nextNumber(db, workspaceId, doc.kind, settings), issue, due, tokenHash(token), encryptSecret(token)]
        );
        break;
      } catch (err) {
        // Two sent at once took the same number; take the next.
        if (attempt >= 3 || !String((err as Error).message).includes("unique")) throw err;
      }
    }
    await closeDocAsks(db, workspaceId, id, "Sent");
    if (doc.kind === "proposal" && doc.leadId) await db.query("UPDATE leads SET status = 'proposal', updated_at = NOW() WHERE id = $1 AND status IN ('new', 'contacted')", [doc.leadId]);
  }
  return (await getDoc(db, workspaceId, id, origin))!;
}

export async function setDocStatus(
  db: Db,
  workspaceId: string,
  id: string,
  change: { status: "paid" | "void" | "accepted" | "declined" | "sent"; paidCents?: number; acceptedName?: string }
): Promise<BusinessDoc> {
  const doc = await getDoc(db, workspaceId, id);
  if (!doc) throw new BusinessError("Not found", 404);
  if (doc.status === "draft" && change.status !== "void") throw new BusinessError("Send it first");
  if (change.status === "paid" && doc.kind !== "invoice") throw new BusinessError("Only invoices are paid");
  if ((change.status === "accepted" || change.status === "declined") && doc.kind !== "proposal") throw new BusinessError("Only proposals are accepted");
  if (change.status === "void") await closeDocAsks(db, workspaceId, id, "Voided");
  if (change.status === "void") await db.query("UPDATE time_entries SET invoice_id = NULL WHERE workspace_id = $1 AND invoice_id = $2", [workspaceId, id]);
  if (change.status === "void") await db.query("UPDATE business_expenses SET invoice_id = NULL WHERE workspace_id = $1 AND invoice_id = $2", [workspaceId, id]);
  const paid = change.status === "paid" ? doc.totals.totalCents : Math.min(change.paidCents ?? doc.paidCents, doc.totals.totalCents);
  await db.query(
    `UPDATE business_docs SET status = $3::text, paid_cents = $4, paid_at = CASE WHEN $3::text = 'paid' THEN NOW() ELSE paid_at END,
       accepted_at = CASE WHEN $3::text = 'accepted' THEN NOW() ELSE accepted_at END, accepted_name = COALESCE($5, accepted_name),
       token_hash = CASE WHEN $3::text = 'void' THEN NULL ELSE token_hash END, token_sealed = CASE WHEN $3::text = 'void' THEN NULL ELSE token_sealed END,
       updated_at = NOW() WHERE workspace_id = $1 AND id = $2`,
    [workspaceId, id, change.status === "sent" && doc.kind === "invoice" && paid >= doc.totals.totalCents && paid > 0 ? "paid" : change.status, paid, change.acceptedName ?? null]
  );
  if (paid !== doc.paidCents) await db.query("INSERT INTO business_payments (workspace_id, doc_id, amount_cents) VALUES ($1, $2, $3)", [workspaceId, id, paid - doc.paidCents]);
  if (change.status === "accepted" && doc.leadId) await db.query("UPDATE leads SET status = 'won', updated_at = NOW() WHERE id = $1", [doc.leadId]);
  return (await getDoc(db, workspaceId, id))!;
}

/** What a link shows: the document and the studio sending it. Null for a wrong or voided link. */
export async function publicDoc(db: Db, token: string): Promise<{ doc: BusinessDoc; studio: BusinessSettings; workspaceName: string; workspaceId: string } | null> {
  if (!validToken(token)) return null;
  const [row] = await db.query<Record<string, unknown>>(`${DOC_SELECT} WHERE d.token_hash = $1 AND d.status <> 'void'`, [tokenHash(token)]);
  if (!row) return null;
  const doc = toDoc(row);
  const [ws] = await db.query<{ name: string }>("SELECT name FROM workspaces WHERE id = $1", [row.workspace_id]);
  return { doc: { ...doc, projectSlug: null, leadId: null }, studio: await getSettings(db, String(row.workspace_id)), workspaceName: ws?.name ?? "", workspaceId: String(row.workspace_id) };
}

/** The client accepts or declines a proposal from its link, with their name typed as their signature. */
export async function respondToProposal(db: Db, token: string, answer: { accept: boolean; name: string; from: string }): Promise<BusinessDoc> {
  const found = await publicDoc(db, token);
  if (!found || found.doc.kind !== "proposal") throw new BusinessError("This link no longer works", 404);
  if (found.doc.status !== "sent") throw new BusinessError(found.doc.status === "accepted" ? "This proposal was already accepted" : "This proposal can no longer be answered", 409);
  if (answer.accept && found.doc.dueDate && found.doc.dueDate < today()) throw new BusinessError("This proposal has expired. Ask the studio for a new one.", 409);
  const name = answer.name.trim().slice(0, 200);
  if (answer.accept && name.length < 2) throw new BusinessError("Type your full name to accept");
  const rows = await db.query<{ workspace_id: string; lead_id: string | null }>(
    `UPDATE business_docs SET status = $2, accepted_at = NOW(), accepted_name = $3, accepted_from = $4, updated_at = NOW()
     WHERE token_hash = $1 AND status = 'sent' RETURNING workspace_id, lead_id`,
    [tokenHash(token), answer.accept ? "accepted" : "declined", name || null, answer.from.slice(0, 100)]
  );
  if (!rows.length) throw new BusinessError("This proposal can no longer be answered", 409);
  if (rows[0].lead_id) await db.query("UPDATE leads SET status = $2, updated_at = NOW() WHERE id = $1", [rows[0].lead_id, answer.accept ? "won" : "lost"]);
  return (await publicDoc(db, token))!.doc;
}

// ---------------------------------------------------------------- time

function toEntry(r: Record<string, unknown>): TimeEntry {
  return {
    id: String(r.id),
    projectId: (r.project_id as string) ?? null,
    projectSlug: (r.slug as string) ?? null,
    projectName: (r.project_name as string) ?? null,
    userId: String(r.user_id),
    phaseKey: (r.phase_key as string) ?? null,
    note: String(r.note ?? ""),
    startedAt: iso(r.started_at)!,
    endedAt: iso(r.ended_at),
    minutes: Number(r.minutes ?? 0),
    billable: !!r.billable,
    rateCents: r.rate_cents == null ? null : Number(r.rate_cents),
    invoiceId: (r.invoice_id as string) ?? null,
  };
}

const TIME_SELECT = "SELECT t.*, p.slug, p.name AS project_name FROM time_entries t LEFT JOIN projects p ON p.id = t.project_id";

export async function listTime(db: Db, workspaceId: string, opts: { userId?: string; projectId?: string; since?: string } = {}): Promise<TimeEntry[]> {
  const where = ["t.workspace_id = $1"];
  const params: unknown[] = [workspaceId];
  if (opts.userId) where.push(`t.user_id = $${params.push(opts.userId)}`);
  if (opts.projectId) where.push(`t.project_id = $${params.push(opts.projectId)}`);
  if (opts.since) where.push(`t.started_at >= $${params.push(opts.since)}`);
  const rows = await db.query<Record<string, unknown>>(`${TIME_SELECT} WHERE ${where.join(" AND ")} ORDER BY t.started_at DESC LIMIT 2000`, params);
  return rows.map(toEntry);
}

export async function runningTimer(db: Db, workspaceId: string, userId: string): Promise<TimeEntry | null> {
  const [row] = await db.query<Record<string, unknown>>(`${TIME_SELECT} WHERE t.workspace_id = $1 AND t.user_id = $2 AND t.ended_at IS NULL`, [workspaceId, userId]);
  return row ? toEntry(row) : null;
}

/** Starts a timer, stopping any that is running first. */
export async function startTimer(db: Db, workspaceId: string, userId: string, p: { projectId: string | null; phaseKey?: string | null; note?: string; billable?: boolean }): Promise<TimeEntry> {
  await stopTimer(db, workspaceId, userId);
  const [row] = await db.query<{ id: string }>(
    "INSERT INTO time_entries (workspace_id, project_id, user_id, phase_key, note, started_at, billable) VALUES ($1, $2, $3, $4, $5, NOW(), $6) RETURNING id",
    [workspaceId, p.projectId, userId, p.phaseKey ?? null, (p.note ?? "").slice(0, 500), p.billable ?? true]
  );
  return (await getEntry(db, workspaceId, row.id))!;
}

export async function stopTimer(db: Db, workspaceId: string, userId: string): Promise<TimeEntry | null> {
  const [row] = await db.query<{ id: string }>(
    `UPDATE time_entries SET ended_at = NOW(), minutes = GREATEST(1, ROUND(EXTRACT(EPOCH FROM (NOW() - started_at)) / 60)::int)
     WHERE workspace_id = $1 AND user_id = $2 AND ended_at IS NULL RETURNING id`,
    [workspaceId, userId]
  );
  return row ? getEntry(db, workspaceId, row.id) : null;
}

export async function getEntry(db: Db, workspaceId: string, id: string): Promise<TimeEntry | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [row] = await db.query<Record<string, unknown>>(`${TIME_SELECT} WHERE t.workspace_id = $1 AND t.id = $2`, [workspaceId, id]);
  return row ? toEntry(row) : null;
}

/** Time logged after the fact: a day, a number of minutes, and what it was for. */
export async function addEntry(
  db: Db,
  workspaceId: string,
  userId: string,
  e: { projectId: string | null; phaseKey?: string | null; day: string; minutes: number; note?: string; billable?: boolean }
): Promise<TimeEntry> {
  if (!(e.minutes > 0 && e.minutes <= 24 * 60)) throw new BusinessError("Between a minute and a day");
  const start = new Date(`${e.day}T09:00:00`);
  const end = new Date(start.getTime() + e.minutes * 60_000);
  const [row] = await db.query<{ id: string }>(
    "INSERT INTO time_entries (workspace_id, project_id, user_id, phase_key, note, started_at, ended_at, minutes, billable) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id",
    [workspaceId, e.projectId, userId, e.phaseKey ?? null, (e.note ?? "").slice(0, 500), start.toISOString(), end.toISOString(), Math.round(e.minutes), e.billable ?? true]
  );
  return (await getEntry(db, workspaceId, row.id))!;
}

export async function updateEntry(
  db: Db,
  workspaceId: string,
  id: string,
  patch: { minutes?: number; note?: string; billable?: boolean; projectId?: string | null; phaseKey?: string | null }
): Promise<TimeEntry> {
  const entry = await getEntry(db, workspaceId, id);
  if (!entry) throw new BusinessError("Not found", 404);
  if (entry.invoiceId) throw new BusinessError("It is on an invoice; take it off the invoice first");
  if (patch.minutes != null && !entry.endedAt) throw new BusinessError("Stop the timer first");
  if (patch.minutes != null && !(patch.minutes > 0 && patch.minutes <= 24 * 60)) throw new BusinessError("Between a minute and a day");
  await db.query(
    `UPDATE time_entries SET minutes = COALESCE($3, minutes), ended_at = CASE WHEN $3::int IS NULL THEN ended_at ELSE started_at + make_interval(mins => $3::int) END, note = COALESCE($4, note), billable = COALESCE($5, billable),
       project_id = CASE WHEN $6::boolean THEN $7::uuid ELSE project_id END, phase_key = CASE WHEN $8::boolean THEN $9::text ELSE phase_key END
     WHERE workspace_id = $1 AND id = $2`,
    [workspaceId, id, patch.minutes ?? null, patch.note ?? null, patch.billable ?? null, patch.projectId !== undefined, patch.projectId ?? null, patch.phaseKey !== undefined, patch.phaseKey ?? null]
  );
  return (await getEntry(db, workspaceId, id))!;
}

export async function deleteEntry(db: Db, workspaceId: string, id: string): Promise<void> {
  const entry = await getEntry(db, workspaceId, id);
  if (!entry) throw new BusinessError("Not found", 404);
  if (entry.invoiceId) throw new BusinessError("It is on an invoice; take it off the invoice first");
  await db.query("DELETE FROM time_entries WHERE workspace_id = $1 AND id = $2", [workspaceId, id]);
}

// ---------------------------------------------------------------- expenses

const EXPENSE_SELECT = "SELECT e.*, p.slug, p.name AS project_name FROM business_expenses e LEFT JOIN projects p ON p.id = e.project_id";

function toExpense(r: Record<string, unknown>): Expense {
  return {
    id: String(r.id),
    projectId: (r.project_id as string) ?? null,
    projectSlug: (r.slug as string) ?? null,
    projectName: (r.project_name as string) ?? null,
    userId: String(r.user_id),
    spentOn: dayOf(r.spent_on)!,
    description: String(r.description),
    amountCents: Number(r.amount_cents),
    markupPct: Number(r.markup_pct ?? 0),
    billable: !!r.billable,
    invoiceId: (r.invoice_id as string) ?? null,
  };
}

export async function listExpenses(db: Db, workspaceId: string, opts: { userId?: string; projectId?: string } = {}): Promise<Expense[]> {
  const where = ["e.workspace_id = $1"];
  const params: unknown[] = [workspaceId];
  if (opts.userId) where.push(`e.user_id = $${params.push(opts.userId)}`);
  if (opts.projectId) where.push(`e.project_id = $${params.push(opts.projectId)}`);
  const rows = await db.query<Record<string, unknown>>(`${EXPENSE_SELECT} WHERE ${where.join(" AND ")} ORDER BY e.spent_on DESC, e.created_at DESC LIMIT 1000`, params);
  return rows.map(toExpense);
}

export async function addExpense(db: Db, workspaceId: string, userId: string, projectId: string | null, input: unknown): Promise<Expense> {
  const e = expenseInput.parse(input);
  const [row] = await db.query<{ id: string }>(
    "INSERT INTO business_expenses (workspace_id, project_id, user_id, spent_on, description, amount_cents, markup_pct, billable) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id",
    [workspaceId, projectId, userId, e.spentOn, e.description, e.amountCents, e.markupPct, e.billable]
  );
  const [out] = await db.query<Record<string, unknown>>(`${EXPENSE_SELECT} WHERE e.id = $1`, [row.id]);
  return toExpense(out);
}

export async function getExpense(db: Db, workspaceId: string, id: string): Promise<Expense | null> {
  const [row] = await db.query<Record<string, unknown>>(`${EXPENSE_SELECT} WHERE e.workspace_id = $1 AND e.id = $2`, [workspaceId, id]);
  return row ? toExpense(row) : null;
}

export async function deleteExpense(db: Db, workspaceId: string, id: string): Promise<void> {
  const e = await getExpense(db, workspaceId, id);
  if (!e) throw new BusinessError("Not found", 404);
  if (e.invoiceId) throw new BusinessError("It is on an invoice; take it off the invoice first");
  await db.query("DELETE FROM business_expenses WHERE workspace_id = $1 AND id = $2", [workspaceId, id]);
}
