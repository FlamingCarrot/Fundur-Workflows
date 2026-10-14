import { after, NextRequest, NextResponse } from "next/server";
import { draftLeadReply } from "@/lib/business/lead-reply";
import { getDb } from "@/lib/db";
import { enquiryInput } from "@/lib/business/model";
import { addLead, BusinessError, enquiryStudio } from "@/lib/business/store";

export const dynamic = "force-dynamic";

/** The studio's name, for the form's heading. */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const db = getDb();
  const studio = db && (await enquiryStudio(db, (await ctx.params).token));
  if (!studio) return NextResponse.json({ error: "This form is no longer open" }, { status: 404 });
  return NextResponse.json({ studioName: studio.studioName });
}

/** A new enquiry from someone who wants to work with the studio. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const db = getDb();
  const studio = db && (await enquiryStudio(db, (await ctx.params).token));
  if (!db || !studio) return NextResponse.json({ error: "This form is no longer open" }, { status: 404 });
  const parsed = enquiryInput.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Add your name, a working email and a short message" }, { status: 400 });
  // Bots fill in the hidden field; they are thanked and nothing is kept.
  if (parsed.data.website) return NextResponse.json({ ok: true });
  try {
    const lead = await addLead(db, studio.workspaceId, parsed.data, "form");
    // A reply is waiting for her by the time she sees the enquiry.
    after(() => draftLeadReply(db, studio.workspaceId, lead.id));
  } catch (err) {
    if (err instanceof BusinessError) return NextResponse.json({ error: err.message }, { status: err.status });
    throw err;
  }
  return NextResponse.json({ ok: true });
}
