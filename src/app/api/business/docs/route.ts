import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { DOC_KINDS, docInput } from "@/lib/business/model";
import { clientParty, draftOrders, invoiceLines, proposalLines } from "@/lib/business/drafts";
import { BusinessError, createDoc, getLead, listDocs } from "@/lib/business/store";
import { handled, projectIdOf, requireBusiness } from "@/lib/business/http";
import { getProject } from "@/lib/projects/store";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const ws = await requireBusiness();
  if (ws instanceof NextResponse) return ws;
  return handled(async () => {
    const kind = z.enum(DOC_KINDS).optional().parse(req.nextUrl.searchParams.get("kind") ?? undefined);
    const projectId = await projectIdOf(ws, req.nextUrl.searchParams.get("project"));
    return NextResponse.json({ docs: await listDocs(ws.db, ws.workspaceId, { kind, projectId: projectId ?? undefined, origin: req.nextUrl.origin }) });
  });
}

const body = z.object({
  kind: z.enum(DOC_KINDS),
  project: z.string().max(100).nullable().optional(),
  leadId: z.string().uuid().nullable().optional(),
  /** Fill it from the project: unbilled time and items for an invoice, its phases for a proposal, one per supplier for orders. */
  fill: z.object({ time: z.boolean().default(false), items: z.boolean().default(false) }).optional(),
  input: docInput.partial().optional(),
});

/** A new draft, filled from the project when asked. Orders come back as several, one per supplier. */
export async function POST(req: NextRequest) {
  const ws = await requireBusiness();
  if (ws instanceof NextResponse) return ws;
  return handled(async () => {
    const b = body.parse(await req.json().catch(() => null));
    const projectId = await projectIdOf(ws, b.project);
    const project = b.project ? await getProject(ws.db, ws.workspaceId, b.project) : null;
    const lead = b.leadId ? await getLead(ws.db, ws.workspaceId, b.leadId) : null;
    if (b.leadId && !lead) throw new BusinessError("Enquiry not found", 404);
    if (b.kind === "purchase_order" && b.fill && project && projectId) {
      const docs = await draftOrders(ws.db, ws.workspaceId, ws.user.id, projectId, project, false);
      if (!docs.length) throw new BusinessError("No items are priced, have a supplier and are still to order");
      return NextResponse.json({ docs });
    }
    const input = { ...(b.input ?? {}) };
    if (project && projectId) {
      input.party ??= await clientParty(ws.db, ws.workspaceId, projectId, project);
      input.title ||= `${project.name}: ${b.kind === "proposal" ? "design fee proposal" : b.kind === "invoice" ? "invoice" : "order"}`;
      if (b.fill && b.kind === "invoice") input.lines = [...(input.lines ?? []), ...(await invoiceLines(ws.db, ws.workspaceId, projectId, project, { time: b.fill.time, items: b.fill.items }))];
      if (b.fill && b.kind === "proposal") input.lines = [...(input.lines ?? []), ...(await proposalLines(ws.db, ws.workspaceId, project, projectId))];
    } else if (lead) {
      input.party ??= { name: lead.company || lead.name, email: lead.email, address: "", vatNumber: "" };
      input.title ||= `Design fee proposal: ${lead.company || lead.name}`;
    }
    const doc = await createDoc(ws.db, ws.workspaceId, ws.user.id, { kind: b.kind, projectId, leadId: lead?.id ?? null, input });
    return NextResponse.json({ docs: [doc] });
  });
}
