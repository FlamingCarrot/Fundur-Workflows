import { NextResponse } from "next/server";
import { teamScope } from "@/lib/comms/http";
import { previewResponse } from "@/lib/comms/routes";
export const dynamic = "force-dynamic";

/** The preview of the first web address in the post. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string; postId: string }> }) {
  const { id, postId } = await params;
  const s = await teamScope(id);
  if (s instanceof NextResponse) return s;
  return previewResponse(s, postId);
}
