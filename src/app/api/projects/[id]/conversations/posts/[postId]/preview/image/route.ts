import { NextResponse } from "next/server";
import { teamScope } from "@/lib/comms/http";
import { previewImageResponse } from "@/lib/comms/routes";
export const dynamic = "force-dynamic";

/** The picture of the post's link preview, fetched here so the supplier never sees who looks. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string; postId: string }> }) {
  const { id, postId } = await params;
  const s = await teamScope(id);
  if (s instanceof NextResponse) return s;
  return previewImageResponse(s, postId);
}
