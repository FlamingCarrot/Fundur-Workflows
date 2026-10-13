import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { BusinessError, publicDoc, respondToProposal } from "@/lib/business/store";

export const dynamic = "force-dynamic";

/** What the link opens: the document and the studio that sent it. Nothing about other work. */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const db = getDb();
  const found = db && (await publicDoc(db, (await ctx.params).token));
  if (!found) return NextResponse.json({ error: "This link no longer works" }, { status: 404 });
  const { doc, studio, workspaceName } = found;
  return NextResponse.json(
    {
      doc: { ...doc, projectId: null, aiDrafted: false, link: null, lines: doc.lines.map((l) => ({ ...l, timeEntryIds: undefined })) },
      studio: { name: studio.studioName || workspaceName, address: studio.address, email: studio.email, phone: studio.phone, registration: studio.registration, vatNumber: studio.vatRegistered ? studio.vatNumber : "", bankDetails: doc.kind === "invoice" ? studio.bankDetails : "" },
    },
    { headers: { "cache-control": "no-store", "x-robots-tag": "noindex" } }
  );
}

const body = z.object({ accept: z.boolean(), name: z.string().max(200).default("") });

/** The client accepts (typing their name) or declines a proposal. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const db = getDb();
  if (!db) return NextResponse.json({ error: "This link no longer works" }, { status: 404 });
  const b = body.safeParse(await req.json().catch(() => null));
  if (!b.success) return NextResponse.json({ error: "Say whether you accept" }, { status: 400 });
  try {
    const from = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
    const doc = await respondToProposal(db, (await ctx.params).token, { accept: b.data.accept, name: b.data.name, from });
    return NextResponse.json({ status: doc.status, acceptedAt: doc.acceptedAt });
  } catch (err) {
    if (err instanceof BusinessError) return NextResponse.json({ error: err.message }, { status: err.status });
    throw err;
  }
}
