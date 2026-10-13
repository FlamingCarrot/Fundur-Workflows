import { NextRequest, NextResponse } from "next/server";
import { enquiryInput } from "@/lib/business/model";
import { addLead, listLeads } from "@/lib/business/store";
import { handled, requireBusiness } from "@/lib/business/http";

export const dynamic = "force-dynamic";

export async function GET() {
  const ws = await requireBusiness();
  if (ws instanceof NextResponse) return ws;
  return NextResponse.json({ leads: await listLeads(ws.db, ws.workspaceId) });
}

/** An enquiry she took by phone or email, added by hand. */
export async function POST(req: NextRequest) {
  const ws = await requireBusiness();
  if (ws instanceof NextResponse) return ws;
  return handled(async () => NextResponse.json({ lead: await addLead(ws.db, ws.workspaceId, enquiryInput.parse(await req.json().catch(() => null)), "manual") }));
}
