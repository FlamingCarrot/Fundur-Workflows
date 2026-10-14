import { NextResponse } from "next/server";
import { teamScope } from "@/lib/comms/http";
import { savedResponse } from "@/lib/comms/routes";
export const dynamic = "force-dynamic";

/** The posts this person saved on the project, with their reminders. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await teamScope((await params).id);
  if (s instanceof NextResponse) return s;
  return savedResponse(s);
}
