import type { Db } from "@/lib/db";
import type { Project } from "@/lib/studio/types";
import { getPhase, getWorkflow } from "@/lib/workflow";
import { expenseLines, itemLines, purchaseOrderDrafts, timeLines, type BusinessDoc, type DocLine, type Party } from "./model";
import { registerByProject } from "./overview";
import { createDoc, getSettings, listDocs, listExpenses, listTime } from "./store";

/**
 * Drafts worked out from what the project holds, shared by the screens and
 * the AI: invoice lines from unbilled time and unbilled items, proposal lines
 * per phase, and purchase orders per supplier.
 */

export async function clientParty(db: Db, workspaceId: string, projectId: string, project: Project): Promise<Party> {
  const [lead] = await db.query<{ email: string }>("SELECT email FROM leads WHERE workspace_id = $1 AND project_id = $2 ORDER BY created_at DESC LIMIT 1", [workspaceId, projectId]);
  return { name: project.client, email: lead?.email ?? "", address: "", vatNumber: "" };
}

export async function invoiceLines(db: Db, workspaceId: string, projectId: string, project: Project, opts: { time: boolean; items: boolean }): Promise<DocLine[]> {
  const settings = await getSettings(db, workspaceId);
  const lines: DocLine[] = [];
  if (opts.time) {
    const time = await listTime(db, workspaceId, { projectId });
    lines.push(...timeLines(time, settings, (key) => (key ? getPhase(project, key)?.name ?? key : "General")));
    // Expenses to recharge go with the time.
    lines.push(...expenseLines(await listExpenses(db, workspaceId, { projectId })));
  }
  if (opts.items) {
    const register = (await registerByProject(db, workspaceId, projectId)).get(projectId);
    const billed = new Set((await listDocs(db, workspaceId, { projectId, kind: "invoice" })).filter((d) => d.status !== "void").flatMap((d) => d.lines.map((l) => l.itemId).filter(Boolean)));
    lines.push(...itemLines((register?.items ?? []).filter((i) => !billed.has(i.id)), settings.defaultMarkupPct));
  }
  return lines;
}

export interface PhaseHours {
  phaseKey: string;
  phase: string;
  /** Hours the plan's tasks are estimated at. */
  plannedHours: number;
  /** Average hours this phase took on the studio's other projects, from logged time. */
  pastHours: number | null;
  pastProjects: number;
  /** Hours logged on this project so far. */
  loggedHours: number;
}

const hours = (minutes: number) => Math.round(minutes / 6) / 10;

/**
 * How long each phase is likely to take, from what the studio knows: the
 * plan's estimates, the time the same phase took on her other projects, and
 * what is logged here so far. Proposals and the AI price from it.
 */
export async function phaseHours(db: Db, workspaceId: string, projectId: string | null, project: Project): Promise<PhaseHours[]> {
  const past = new Map<string, { minutes: number; projects: number }>();
  for (const r of await db.query<{ phase_key: string; minutes: string; projects: string }>(
    `SELECT phase_key, AVG(m) AS minutes, COUNT(*) AS projects FROM (
       SELECT project_id, phase_key, SUM(minutes) AS m FROM time_entries
       WHERE workspace_id = $1 AND project_id IS NOT NULL AND project_id IS DISTINCT FROM $2::uuid AND phase_key IS NOT NULL AND ended_at IS NOT NULL
       GROUP BY project_id, phase_key
     ) s GROUP BY phase_key`,
    [workspaceId, projectId]
  ))
    past.set(r.phase_key, { minutes: Number(r.minutes), projects: Number(r.projects) });
  const logged = new Map<string, number>();
  if (projectId)
    for (const r of await db.query<{ phase_key: string; minutes: string }>(
      "SELECT phase_key, SUM(minutes) AS minutes FROM time_entries WHERE workspace_id = $1 AND project_id = $2 AND phase_key IS NOT NULL GROUP BY phase_key",
      [workspaceId, projectId]
    ))
      logged.set(r.phase_key, Number(r.minutes));
  return getWorkflow(project).phases.map((p) => {
    const planned = project.tasks.filter((t) => t.phaseKey === p.key).reduce((sum, t) => sum + (t.estimateHours ?? 0), 0);
    const before = past.get(p.key);
    return {
      phaseKey: p.key,
      phase: p.name,
      plannedHours: Math.round(planned * 10) / 10,
      pastHours: before && before.minutes > 0 ? hours(before.minutes) : null,
      pastProjects: before?.projects ?? 0,
      loggedHours: hours(logged.get(p.key) ?? 0),
    };
  });
}

/** The hours to quote for a phase: the plan's estimate, else what it took before, else a day. */
export function quoteHours(h: PhaseHours): number {
  if (h.plannedHours > 0) return h.plannedHours;
  if (h.pastHours) return Math.max(1, Math.round(h.pastHours * 2) / 2);
  return 8;
}

/** A starting point for a fee proposal: one line per phase, priced at the studio's rate for the hours it is likely to take. */
export async function proposalLines(db: Db, workspaceId: string, project: Project, projectId: string | null = null): Promise<DocLine[]> {
  const settings = await getSettings(db, workspaceId);
  const guide = await phaseHours(db, workspaceId, projectId, project);
  return getWorkflow(project).phases.map((p, i) => ({
    id: `phase-${i + 1}`,
    description: `${p.name}${p.description ? `: ${p.description}` : ""}`.slice(0, 500),
    quantity: quoteHours(guide[i]),
    unitCents: settings.hourlyRateCents,
    kind: "fee" as const,
    markupPct: 0,
  }));
}

/** One draft purchase order per supplier for items still to order, leaving out items already on an order. */
export async function draftOrders(db: Db, workspaceId: string, userId: string, projectId: string, project: Project, aiDrafted: boolean): Promise<BusinessDoc[]> {
  const register = (await registerByProject(db, workspaceId, projectId)).get(projectId);
  const ordered = new Set((await listDocs(db, workspaceId, { projectId, kind: "purchase_order" })).filter((d) => d.status !== "void").flatMap((d) => d.lines.map((l) => l.itemId).filter(Boolean)));
  const out: BusinessDoc[] = [];
  for (const d of purchaseOrderDrafts((register?.items ?? []).filter((i) => !ordered.has(i.id)))) {
    out.push(
      await createDoc(db, workspaceId, userId, {
        kind: "purchase_order",
        projectId,
        input: { title: `${project.name}: order from ${d.supplier}`, party: { name: d.supplier, email: "", address: "", vatNumber: "" }, lines: d.lines, notes: `For ${project.name} (${project.client}).` },
        aiDrafted,
      })
    );
  }
  return out;
}
