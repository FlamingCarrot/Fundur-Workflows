import { NextResponse } from "next/server";
import { teamScope } from "@/lib/comms/http";
import { searchResponse } from "@/lib/comms/routes";
export const dynamic = "force-dynamic";

/** Posts and replies in this person's channels that contain the words in ?q. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await teamScope((await params).id);
  if (s instanceof NextResponse) return s;
  return searchResponse(s, new URL(req.url));
}
