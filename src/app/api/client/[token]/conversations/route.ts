import { NextResponse } from "next/server";
import { clientScope } from "@/lib/comms/http";
import { channelsResponse } from "@/lib/comms/routes";
export const dynamic = "force-dynamic";

/** The channels the studio shared with this client. */
export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const s = await clientScope((await params).token);
  if (s instanceof NextResponse) return s;
  return channelsResponse(s);
}
