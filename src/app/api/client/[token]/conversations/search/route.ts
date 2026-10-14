import { NextResponse } from "next/server";
import { clientScope } from "@/lib/comms/http";
import { searchResponse } from "@/lib/comms/routes";
export const dynamic = "force-dynamic";

/** Posts in the client's channels that contain the words in ?q. */
export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const s = await clientScope((await params).token);
  if (s instanceof NextResponse) return s;
  return searchResponse(s, new URL(req.url));
}
