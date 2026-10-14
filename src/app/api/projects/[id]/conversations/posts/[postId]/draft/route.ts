import { NextResponse } from "next/server";
import { z } from "zod";
import { commsFailure, commsJson, teamScope } from "@/lib/comms/http";
import { draftReply } from "@/lib/comms/write-help";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** The assistant drafts a reply to the post's thread, for this person to change and send. */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string; postId: string }> }) {
  const { id, postId } = await params;
  const s = await teamScope(id);
  if (s instanceof NextResponse) return s;
  if (s.ctx.features.ai === false) return commsJson({ error: "The assistant is turned off for this workspace" }, 403);
  if (!z.uuid().safeParse(postId).success) return commsJson({ error: "Post not found" }, 404);
  try {
    return commsJson({ draft: await draftReply(s, postId) });
  } catch (e) {
    return commsFailure(e);
  }
}
