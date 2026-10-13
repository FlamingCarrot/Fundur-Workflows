import { NextResponse } from "next/server";
import { clientScope } from "@/lib/comms/http";
import { meetingsResponse } from "@/lib/comms/routes";
export const dynamic = "force-dynamic";

/** The meetings the studio invited this client to. */
export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const s = await clientScope((await params).token);
  if (s instanceof NextResponse) return s;
  return meetingsResponse(s, new URL(req.url));
}
