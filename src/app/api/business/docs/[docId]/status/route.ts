import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { markSent, setDocStatus } from "@/lib/business/store";
import { handled, requireBusiness } from "@/lib/business/http";
import { markItemsOrdered } from "@/lib/business/drafts";

export const dynamic = "force-dynamic";

const body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("send") }),
  z.object({ action: z.literal("paid") }),
  z.object({ action: z.literal("payment"), paidCents: z.number().int().min(0) }),
  z.object({ action: z.literal("void") }),
  z.object({ action: z.literal("accepted"), name: z.string().trim().min(2).max(200) }),
  z.object({ action: z.literal("declined") }),
]);

/**
 * Moves a document on: sent (it gets its number and the client's link; a
 * purchase order's items read as ordered),
 * paid or part paid, accepted (for a proposal the client accepted outside the
 * link), declined, or voided.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ docId: string }> }) {
  const ws = await requireBusiness();
  if (ws instanceof NextResponse) return ws;
  const { docId } = await ctx.params;
  return handled(async () => {
    const b = body.parse(await req.json().catch(() => null));
    if (b.action === "send") {
      const doc = await markSent(ws.db, ws.workspaceId, docId, req.nextUrl.origin);
      // A sent order moves its items on to ordered in the project's register.
      await markItemsOrdered(ws.db, ws.workspaceId, ws.user.id, doc);
      return NextResponse.json({ doc });
    }
    const doc =
      b.action === "payment"
        ? await setDocStatus(ws.db, ws.workspaceId, docId, { status: "sent", paidCents: b.paidCents })
        : await setDocStatus(ws.db, ws.workspaceId, docId, { status: b.action, acceptedName: b.action === "accepted" ? b.name : undefined });
    return NextResponse.json({ doc });
  });
}
