import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { assertCanCreateProject, limitResponse, PlanLimitError } from "@/lib/billing/guard";
import { getLead, updateLead } from "@/lib/business/store";
import { requireBusiness } from "@/lib/business/http";
import { applyMutation, createProject, projectDbId } from "@/lib/projects/store";
import { DEFAULT_WORKFLOW_ID, getForm } from "@/lib/workflow";

export const dynamic = "force-dynamic";

const body = z.object({ workflowId: z.string().max(100).default(DEFAULT_WORKFLOW_ID), name: z.string().trim().min(1).max(255).optional() });

const slugify = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 40) || "project";

/** Won: the enquiry becomes a project, with the client's message kept in the brief's first field. Its proposals move with it. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ leadId: string }> }) {
  const ws = await requireBusiness();
  if (ws instanceof NextResponse) return ws;
  const lead = await getLead(ws.db, ws.workspaceId, (await ctx.params).leadId);
  if (!lead) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (lead.projectSlug) return NextResponse.json({ error: "It already has a project", slug: lead.projectSlug }, { status: 409 });
  const b = body.safeParse(await req.json().catch(() => ({})));
  if (!b.success) return NextResponse.json({ error: "Choose a workflow" }, { status: 400 });
  try {
    await assertCanCreateProject(ws, b.data.workflowId);
  } catch (err) {
    if (err instanceof PlanLimitError) return limitResponse(err);
    throw err;
  }
  const client = lead.company || lead.name;
  const name = b.data.name || `${client} project`;
  const project = await createProject(ws.db, ws.workspaceId, {
    id: `${slugify(name)}-${Math.random().toString(36).slice(2, 6)}`,
    name,
    client,
    workflowId: b.data.workflowId,
    startDate: new Date().toISOString(),
    swatch: "clay",
  });
  const projectId = (await projectDbId(ws.db, ws.workspaceId, project.id))!;
  const first = getForm(project, "brief")?.fields[0];
  const said = [lead.message, lead.budget && `Budget mentioned: ${lead.budget}`].filter(Boolean).join("\n\n");
  if (first && said) await applyMutation(ws.db, ws.workspaceId, project.id, { type: "updateBrief", patch: { [first.key]: `From the enquiry: ${said}`.slice(0, 5000) }, fromAi: false });
  await updateLead(ws.db, ws.workspaceId, lead.id, { status: "won", projectId });
  await ws.db.query("UPDATE business_docs SET project_id = $3 WHERE workspace_id = $1 AND lead_id = $2 AND project_id IS NULL", [ws.workspaceId, lead.id, projectId]);
  return NextResponse.json({ project });
}
