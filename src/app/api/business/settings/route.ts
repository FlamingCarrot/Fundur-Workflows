import { NextRequest, NextResponse } from "next/server";
import { businessSettings } from "@/lib/business/model";
import { enquiryToken, getSettings, saveSettings } from "@/lib/business/store";
import { handled, requireBusiness } from "@/lib/business/http";

export const dynamic = "force-dynamic";

/** The studio's details, VAT, rates and terms, with its enquiry form's link. */
export async function GET(req: NextRequest) {
  const ws = await requireBusiness();
  if (ws instanceof NextResponse) return ws;
  return handled(async () =>
    NextResponse.json({ settings: await getSettings(ws.db, ws.workspaceId), enquiryLink: `${req.nextUrl.origin}/enquire/${await enquiryToken(ws.db, ws.workspaceId)}` })
  );
}

export async function PUT(req: NextRequest) {
  const ws = await requireBusiness();
  if (ws instanceof NextResponse) return ws;
  return handled(async () => {
    const patch = businessSettings.partial().parse(await req.json().catch(() => ({})));
    return NextResponse.json({ settings: await saveSettings(ws.db, ws.workspaceId, ws.user.id, patch) });
  });
}

/** A new enquiry link; the old one stops working. */
export async function POST(req: NextRequest) {
  const ws = await requireBusiness();
  if (ws instanceof NextResponse) return ws;
  return handled(async () => NextResponse.json({ enquiryLink: `${req.nextUrl.origin}/enquire/${await enquiryToken(ws.db, ws.workspaceId, true)}` }));
}
