import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createSupportRequest, listMySupport } from "@/lib/support/store";
import { SUPPORT_TOPICS, type SupportTopic } from "@/lib/support/types";
import { requireWorkspace } from "@/lib/server/workspace-context";

export const dynamic = "force-dynamic";

/** The signed-in person's own support requests. */
export async function GET() {
  const ctx = await requireWorkspace();
  if (ctx instanceof NextResponse) return ctx;
  return NextResponse.json({ requests: await listMySupport(ctx.db, ctx.user.id) });
}

const newRequest = z.object({
  topic: z.enum(Object.keys(SUPPORT_TOPICS) as [SupportTopic, ...SupportTopic[]]),
  subject: z.string().trim().min(1).max(200),
  message: z.string().trim().min(1).max(10_000),
  path: z.string().max(2_000).default("/support"),
});

/** Asks for help; it shows in the Admin's ticket queue straight away. */
export async function POST(req: NextRequest) {
  const ctx = await requireWorkspace();
  if (ctx instanceof NextResponse) return ctx;
  const parsed = newRequest.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Add a short subject and your message" }, { status: 400 });
  const request = await createSupportRequest(ctx.db, ctx.workspaceId, ctx.user.id, parsed.data);
  return NextResponse.json({ request }, { status: 201 });
}
