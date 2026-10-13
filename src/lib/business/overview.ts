import type { Db } from "@/lib/db";
import { isOverdue, projectMoney, type BusinessDoc, type ProjectMoney, type RegisterItem } from "./model";
import { getSettings, listDocs, listLeads, listTime } from "./store";

/**
 * The studio's money at a glance, and each project's: time worked and not yet
 * billed, proposals out and accepted, invoiced, paid, owed and overdue, the
 * fee earned per hour, and the item budget against what is specified.
 */

export interface BusinessOverview {
  currency: string;
  projects: ProjectMoney[];
  totals: { unbilledCents: number; outstandingCents: number; overdueCents: number; proposedCents: number; paidThisMonthCents: number; minutesThisWeek: number };
  overdue: BusinessDoc[];
  newLeads: number;
}

/** Items and budget from each project's register, keyed by project id. */
export async function registerByProject(db: Db, workspaceId: string, projectId?: string): Promise<Map<string, { budgetCents: number | null; items: RegisterItem[] }>> {
  const rows = await db.query<{ project_id: string; data: unknown }>(
    `SELECT project_id, data FROM project_design WHERE workspace_id = $1 ${projectId ? "AND project_id = $2" : ""}`,
    projectId ? [workspaceId, projectId] : [workspaceId]
  );
  const out = new Map<string, { budgetCents: number | null; items: RegisterItem[] }>();
  for (const r of rows) {
    const data = (typeof r.data === "string" ? JSON.parse(r.data) : r.data) as { budgetCents?: number | null; items?: RegisterItem[] } | null;
    out.set(r.project_id, { budgetCents: data?.budgetCents ?? null, items: (data?.items ?? []).map((i) => ({ id: i.id, name: i.name, quantity: i.quantity, unitPriceCents: i.unitPriceCents, supplier: i.supplier ?? "", status: i.status })) });
  }
  return out;
}

export async function businessOverview(db: Db, workspaceId: string, today = new Date().toISOString().slice(0, 10)): Promise<BusinessOverview> {
  const settings = await getSettings(db, workspaceId);
  const projects = await db.query<{ id: string; slug: string; name: string; client_name: string }>(
    "SELECT id, slug, name, client_name FROM projects WHERE workspace_id = $1 AND status <> 'archived' ORDER BY updated_at DESC",
    [workspaceId]
  );
  const docs = await listDocs(db, workspaceId);
  const time = await listTime(db, workspaceId);
  const register = await registerByProject(db, workspaceId);
  const money = projects.map((p) => projectMoney({ projectId: p.id, slug: p.slug, name: p.name, client: p.client_name }, docs, time, settings, register.get(p.id) ?? null, today));
  const month = today.slice(0, 7);
  const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
  return {
    currency: settings.currency,
    projects: money.filter((m) => m.minutes || m.invoicedCents || m.proposedCents || m.acceptedCents || m.itemSpecCents || m.itemBudgetCents),
    totals: {
      unbilledCents: money.reduce((s, m) => s + m.unbilledCents, 0),
      outstandingCents: money.reduce((s, m) => s + m.outstandingCents, 0) + docs.filter((d) => !d.projectId && d.kind === "invoice" && d.status === "sent").reduce((s, d) => s + d.totals.totalCents - d.paidCents, 0),
      overdueCents: docs.filter((d) => isOverdue(d, today)).reduce((s, d) => s + d.totals.totalCents - d.paidCents, 0),
      proposedCents: docs.filter((d) => d.kind === "proposal" && d.status === "sent").reduce((s, d) => s + d.totals.totalCents, 0),
      paidThisMonthCents: docs.filter((d) => d.kind === "invoice" && d.status === "paid" && d.paidAt?.slice(0, 7) === month).reduce((s, d) => s + d.totals.totalCents, 0),
      minutesThisWeek: time.filter((t) => t.startedAt >= weekAgo && t.endedAt).reduce((s, t) => s + t.minutes, 0),
    },
    overdue: docs.filter((d) => isOverdue(d, today)),
    newLeads: (await listLeads(db, workspaceId)).filter((l) => l.status === "new").length,
  };
}

/** What the autopilot needs to know about one project's money. */
export interface MoneyFacts {
  hasProposal: boolean;
  proposalAccepted: boolean;
  unbilledMinutes: number;
  unbilledCents: number;
  draftInvoices: number;
  overdue: { number: string; totalCents: number; dueDate: string }[];
  itemsToOrder: number;
  draftOrders: number;
  overBudgetCents: number | null;
  currency: string;
}

export async function moneyFacts(db: Db, workspaceId: string, p: { projectId: string; slug: string; name: string; client: string }, today = new Date().toISOString().slice(0, 10)): Promise<MoneyFacts> {
  const settings = await getSettings(db, workspaceId);
  const docs = await listDocs(db, workspaceId, { projectId: p.projectId });
  const time = await listTime(db, workspaceId, { projectId: p.projectId });
  const register = (await registerByProject(db, workspaceId, p.projectId)).get(p.projectId) ?? null;
  const m = projectMoney(p, docs, time, settings, register, today);
  const live = docs.filter((d) => d.status !== "void");
  return {
    hasProposal: live.some((d) => d.kind === "proposal"),
    proposalAccepted: live.some((d) => d.kind === "proposal" && d.status === "accepted"),
    unbilledMinutes: m.unbilledMinutes,
    unbilledCents: m.unbilledCents,
    draftInvoices: live.filter((d) => d.kind === "invoice" && d.status === "draft").length,
    overdue: live.filter((d) => isOverdue(d, today)).map((d) => ({ number: d.number ?? "", totalCents: d.totals.totalCents - d.paidCents, dueDate: d.dueDate ?? "" })),
    itemsToOrder: (register?.items ?? []).filter((i) => i.supplier.trim() && i.unitPriceCents != null && ["needs_sourcing", "quote_requested"].includes(i.status) && !live.some((d) => d.kind === "purchase_order" && d.lines.some((l) => l.itemId === i.id))).length,
    draftOrders: live.filter((d) => d.kind === "purchase_order" && d.status === "draft").length,
    overBudgetCents: m.itemBudgetCents != null && m.itemSpecCents > m.itemBudgetCents ? m.itemSpecCents - m.itemBudgetCents : null,
    currency: settings.currency,
  };
}
