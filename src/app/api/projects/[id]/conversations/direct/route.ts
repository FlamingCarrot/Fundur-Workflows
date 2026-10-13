import { NextResponse } from "next/server";
import { z } from "zod";
import { teamScope, commsFailure, commsJson, readBody } from "@/lib/comms/http";
import { openDirect } from "@/lib/comms/store";
export const dynamic = "force-dynamic";

const body = z.object({ with: z.string().min(1).max(255) }).strict();

/** Opens (starting when needed) this person's direct conversation with a teammate on the project. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await teamScope((await params).id);
  if (s instanceof NextResponse) return s;
  const input = body.safeParse(await readBody(req));
  if (!input.success) return commsJson({ error: "Choose someone to message" }, 400);
  try {
    return commsJson({ channel: await openDirect(s, input.data.with) });
  } catch (e) {
    return commsFailure(e);
  }
}
