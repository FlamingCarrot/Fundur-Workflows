import { NextResponse } from "next/server";
import { clientScope } from "@/lib/comms/http";
import { previewResponse } from "@/lib/comms/routes";
export const dynamic = "force-dynamic";

/** The preview of the first web address in the post. */
export async function GET(_req: Request, { params }: { params: Promise<{ token: string; postId: string }> }) {
  const { token, postId } = await params;
  const s = await clientScope(token);
  if (s instanceof NextResponse) return s;
  return previewResponse(s, postId);
}
