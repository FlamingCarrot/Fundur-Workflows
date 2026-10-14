import { NextRequest, NextResponse } from "next/server";
import { draftLeadReply } from "@/lib/business/lead-reply";
import { getLead } from "@/lib/business/store";
import { requireBusiness } from "@/lib/business/http";

export const dynamic = "force-dynamic";

/** Drafts the enquiry's reply again. */
export async function POST(_req: NextRequest, ctx: { params: Promise<{ leadId: string }> }) {
  const ws = await requireBusiness();
  if (ws instanceof NextResponse) return ws;
  const { leadId } = await ctx.params;
  if (!(await getLead(ws.db, ws.workspaceId, leadId))) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const reply = await draftLeadReply(ws.db, ws.workspaceId, leadId);
  if (!reply) return NextResponse.json({ error: "The AI couldn't write one just now. Check that AI is set up and within its allowance." }, { status: 503 });
  return NextResponse.json({ reply });
}
