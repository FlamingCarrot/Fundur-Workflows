import type { Db } from "@/lib/db";
import type { Project } from "@/lib/studio/types";
import { getPhase, getWorkflow } from "@/lib/workflow";
import { itemLines, purchaseOrderDrafts, timeLines, type BusinessDoc, type DocLine, type Party } from "./model";
import { registerByProject } from "./overview";
import { createDoc, getSettings, listDocs, listTime } from "./store";

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
  }
  if (opts.items) {
    const register = (await registerByProject(db, workspaceId, projectId)).get(projectId);
    const billed = new Set((await listDocs(db, workspaceId, { projectId, kind: "invoice" })).filter((d) => d.status !== "void").flatMap((d) => d.lines.map((l) => l.itemId).filter(Boolean)));
    lines.push(...itemLines((register?.items ?? []).filter((i) => !billed.has(i.id)), settings.defaultMarkupPct));
  }
  return lines;
}

/** A starting point for a fee proposal: one line per phase, priced as a day of the studio's time each until she sets the fees. */
export async function proposalLines(db: Db, workspaceId: string, project: Project): Promise<DocLine[]> {
  const settings = await getSettings(db, workspaceId);
  return getWorkflow(project).phases.map((p, i) => ({ id: `phase-${i + 1}`, description: `${p.name}${p.description ? `: ${p.description}` : ""}`.slice(0, 500), quantity: 8, unitCents: settings.hourlyRateCents, kind: "fee" as const, markupPct: 0 }));
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
