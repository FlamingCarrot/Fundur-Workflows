import { NextResponse } from "next/server";
import { clientScope } from "@/lib/comms/http";
import { attachmentResponse } from "@/lib/comms/routes";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ token: string; postId: string; fileId: string }> };

export async function GET(req: Request, { params }: Context) {
  const { token, postId, fileId } = await params;
  const s = await clientScope(token);
  if (s instanceof NextResponse) return s;
  return attachmentResponse(s, postId, fileId, new URL(req.url));
}
