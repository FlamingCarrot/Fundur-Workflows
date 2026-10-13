import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { LEAD_STATUSES } from "@/lib/business/model";
import { getLead, updateLead } from "@/lib/business/store";
import { handled, requireBusiness } from "@/lib/business/http";

export const dynamic = "force-dynamic";

const patch = z.object({ status: z.enum(LEAD_STATUSES).optional(), notes: z.string().max(5000).optional() });

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ leadId: string }> }) {
  const ws = await requireBusiness();
  if (ws instanceof NextResponse) return ws;
  const { leadId } = await ctx.params;
  return handled(async () => {
    if (!(await getLead(ws.db, ws.workspaceId, leadId))) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ lead: await updateLead(ws.db, ws.workspaceId, leadId, patch.parse(await req.json().catch(() => null))) });
  });
}
