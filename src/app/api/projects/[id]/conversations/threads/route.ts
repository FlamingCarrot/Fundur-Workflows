import { NextResponse } from "next/server";
import { teamScope } from "@/lib/comms/http";
import { myThreadsResponse } from "@/lib/comms/routes";
export const dynamic = "force-dynamic";

/** The threads this person is in, newest reply first. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await teamScope((await params).id);
  if (s instanceof NextResponse) return s;
  return myThreadsResponse(s);
}
