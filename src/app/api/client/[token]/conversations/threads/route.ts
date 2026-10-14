import { NextResponse } from "next/server";
import { clientScope } from "@/lib/comms/http";
import { myThreadsResponse } from "@/lib/comms/routes";
export const dynamic = "force-dynamic";

/** The threads this person is in, newest reply first. */
export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const s = await clientScope((await params).token);
  if (s instanceof NextResponse) return s;
  return myThreadsResponse(s);
}
